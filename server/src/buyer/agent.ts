import { directory, resolveService } from "../ens";
import { parseHbar } from "../hbar";
import type { PurchaseIntent, ServiceCard } from "../types";
import { executeIntent, lookups, type Attestation, type IntentOutcome, type Reliability } from "./executor";
import { getActivePolicy, type ActivePolicy } from "./policy";

export type AgentStage = "discovery" | "resolution" | "preference" | "authorization" | "payment" | "receipt" | "done";

export type AgentEvent = { stage: AgentStage; ts: number } & Record<string, unknown>;

export type AgentDeps = {
  policy: (hash: string) => ActivePolicy | undefined;
  directory: (capability: string) => Promise<string[]>;
  resolve: (name: string) => Promise<ServiceCard>;
  reliability: (name: string) => Promise<Reliability | null>;
  attestation: (name: string) => Promise<Attestation | null>;
  execute: (intent: PurchaseIntent) => Promise<IntentOutcome>;
};

export const defaultDeps: AgentDeps = {
  policy: getActivePolicy,
  directory,
  resolve: resolveService,
  reliability: (name) => lookups.reliability(name),
  attestation: (name) => lookups.attestation(name),
  execute: executeIntent,
};

const KNOWN_PROTOCOLS = ["aave", "compound", "uniswap", "lido", "maker", "curve", "morpho", "spark", "balancer", "sushi"];

export function planTask(task: string): { capability: string; protocol: string; route: string; rationale: string } {
  const text = task.toLowerCase();
  const protocol = KNOWN_PROTOCOLS.find((p) => text.includes(p)) ?? text.match(/[a-z][a-z0-9-]+/g)?.at(-1) ?? "aave";
  const route = /\b(deep|thorough|detailed)\b/.test(text) ? "/assess/deep" : "/assess";
  return {
    capability: "financial-risk",
    protocol,
    route,
    rationale: `task mentions ${/risk|assess|safe|exposure/.test(text) ? "risk assessment" : "a protocol"}; only capability offered is financial-risk`,
  };
}

export type Candidate = { card: ServiceCard; reliability: Reliability | null; attested: boolean };

export function isAttested(attestation: Attestation | null): boolean {
  return attestation?.valid === true && attestation.expiry > Math.floor(Date.now() / 1000);
}

export function rank(candidates: Candidate[]): Candidate[] {
  const rate = (c: Candidate) => (c.reliability && c.reliability.sampleSize > 0 ? (c.reliability.successRate ?? 0) : -1);
  return [...candidates].sort((a, b) => {
    if (a.attested !== b.attested) return a.attested ? -1 : 1;
    if (rate(a) !== rate(b)) return rate(b) - rate(a);
    return parseHbar(a.card.price) - parseHbar(b.card.price);
  });
}

const event = (stage: AgentStage, data: Record<string, unknown>): AgentEvent => ({ stage, ts: Date.now(), ...data });

export async function* run(task: string, policyHash: string, deps: AgentDeps = defaultDeps): AsyncGenerator<AgentEvent> {
  const active = deps.policy(policyHash);
  if (!active) {
    yield event("done", { outcome: "NO_ACTIVE_POLICY", policyHash });
    return;
  }
  const plan = planTask(task);
  let names: string[];
  try {
    names = await deps.directory(plan.capability);
  } catch (err) {
    yield event("done", { outcome: "DIRECTORY_UNAVAILABLE", error: err instanceof Error ? err.message : String(err) });
    return;
  }
  yield event("discovery", { task, ...plan, names });

  const candidates: Candidate[] = [];
  for (const name of names) {
    try {
      const card = await deps.resolve(name);
      const [reliability, attestation] = await Promise.all([deps.reliability(card.name), deps.attestation(card.name)]);
      const attested = isAttested(attestation);
      candidates.push({ card, reliability, attested });
      yield event("resolution", { name, card, reliability, attested });
    } catch (err) {
      yield event("resolution", { name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const ranked = rank(candidates);
  yield event("preference", {
    ranking: ranked.map((c, i) => ({
      rank: i + 1,
      name: c.card.name,
      price: c.card.price,
      attested: c.attested,
      ensVerifiedFlag: c.card.verified,
      successRate: c.reliability?.successRate ?? null,
      sampleSize: c.reliability?.sampleSize ?? 0,
    })),
    rule: "attested (verifier-signed) first, then success rate, then price; the ENS mandi:verified flag is display only",
  });

  const rejections: { supplier: string; reasons: string[] }[] = [];
  let approved = 0;
  for (const { card } of ranked) {
    const outcome = await deps.execute({ supplier: card.name, route: plan.route, protocol: plan.protocol, policyHash });
    yield event("authorization", { supplier: card.name, decision: outcome.decision, hcsTx: outcome.hcsTx });
    if (outcome.decision.status !== "approved" || !outcome.payment) {
      rejections.push({ supplier: card.name, reasons: outcome.decision.reasons });
      continue;
    }
    approved += 1;
    yield event("payment", { supplier: card.name, payment: { ...outcome.payment, body: undefined }, ledger: outcome.ledger });
    yield event("receipt", {
      supplier: card.name,
      settled: outcome.payment.settled,
      fulfilled: outcome.payment.fulfilled,
      txId: outcome.payment.txId,
      hashscan: outcome.payment.hashscan,
      latencyMs: outcome.payment.latencyMs,
      body: outcome.payment.body,
      error: outcome.payment.error,
    });
    if (outcome.payment.fulfilled) {
      yield event("done", { outcome: "FULFILLED", supplier: card.name, result: outcome.payment.body, ledger: outcome.ledger });
      return;
    }
    if (!active.policy.fallbackOnFailure) {
      yield event("done", { outcome: "FAILED_NO_FALLBACK", supplier: card.name, ledger: outcome.ledger });
      return;
    }
  }
  yield event("done", {
    outcome: approved === 0 ? "NO_ELIGIBLE_SUPPLIER" : "ALL_APPROVED_SUPPLIERS_FAILED",
    rejections,
    ledger: active.ledger,
  });
}
