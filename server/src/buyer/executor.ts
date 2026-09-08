import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import type { PaymentRequirements } from "@x402/core/types";
import { createClientHederaSigner, PrivateKey, type ClientHederaSigner } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { config, requireEnv } from "../config";
import { resolveService } from "../ens";
import { parseHbar, toTinybar } from "../hbar";
import { hashscanTx, hcsSubmit } from "../hedera";
import type { Check, Decision, Policy, PurchaseIntent, ServiceCard } from "../types";
import { getActivePolicy, type ActivePolicy, type Ledger } from "./policy";

const HBAR_ASSET = "0.0.0";

function buyerKey(): PrivateKey {
  const raw = requireEnv("BUYER_KEY");
  if (raw.startsWith("0x")) return PrivateKey.fromStringECDSA(raw);
  if (raw.startsWith("30")) return PrivateKey.fromStringDer(raw);
  return PrivateKey.fromString(raw);
}

let signer: ClientHederaSigner | undefined;

function buyerSigner(): ClientHederaSigner {
  if (!signer) {
    signer = createClientHederaSigner(requireEnv("BUYER_ACCOUNT_ID"), buyerKey(), {
      network: config.x402.network,
    });
  }
  return signer;
}

export function acceptFilter(capHbar: number): (reqs: readonly PaymentRequirements[]) => PaymentRequirements[] {
  const cap = toTinybar(capHbar);
  return (reqs) =>
    reqs.filter(
      (r) => r.network === config.x402.network && r.asset === HBAR_ASSET && BigInt(r.amount) <= cap,
    );
}

export function paidFetch(capHbar = Number.POSITIVE_INFINITY): typeof fetch {
  const client = x402Client.fromConfig({
    schemes: [{ network: "hedera:*", client: new ExactHederaScheme(buyerSigner()) }],
    spendControls: false,
    policies: [(_version, reqs) => acceptFilter(capHbar)(reqs)],
  });
  return wrapFetchWithPayment(fetch, client);
}

export type Reliability = {
  calls: number;
  fulfilled: number;
  failed: number;
  successRate: number | null;
  sampleSize: number;
};

export type Attestation = {
  valid: boolean;
  expiry: number;
  reason?: string;
};

export type DecisionContext = {
  card: ServiceCard;
  policy: Policy;
  policyHash: string;
  ledger: Ledger;
  reliability: Reliability | null;
  attestation: Attestation | null;
};

export function requiresVerification(policy: Policy, capability: string): boolean {
  return policy.requireVerifiedFor.some((tag) => capability === tag || capability.startsWith(`${tag}-`));
}

function round(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

export function decide(intent: Pick<PurchaseIntent, "supplier" | "route">, ctx: DecisionContext): Decision {
  const price = parseHbar(ctx.card.price);
  const maxPerCall = parseHbar(ctx.policy.maxPerCall);
  const remaining = round(parseHbar(ctx.policy.budgetTotal) - ctx.ledger.spentHbar);
  const checks: Check[] = [];

  checks.push({
    name: "identity",
    passed: ctx.card.name === intent.supplier && ctx.card.chain === config.x402.network,
    detail: `${intent.supplier} resolves to ${ctx.card.endpoint} on ${ctx.card.chain}`,
  });

  checks.push({
    name: "price-cap",
    passed: price <= maxPerCall,
    detail: `advertised ${ctx.card.price} vs maxPerCall ${ctx.policy.maxPerCall}`,
  });

  checks.push({
    name: "budget",
    passed: price <= remaining,
    detail: `needs ${price} HBAR, ${remaining} HBAR of ${ctx.policy.budgetTotal} remaining`,
  });

  if (ctx.reliability && ctx.reliability.sampleSize > 0 && ctx.reliability.successRate !== null) {
    checks.push({
      name: "reliability",
      passed: ctx.reliability.successRate >= ctx.policy.minSuccessRate,
      detail: `success rate ${(ctx.reliability.successRate * 100).toFixed(1)}% over ${ctx.reliability.sampleSize} settled calls vs minSuccessRate ${(ctx.policy.minSuccessRate * 100).toFixed(0)}%`,
    });
  } else {
    checks.push({
      name: "reliability",
      passed: true,
      detail: "no settled history yet (sample size 0), minSuccessRate not enforceable",
    });
  }

  if (requiresVerification(ctx.policy, ctx.card.capability)) {
    const attested = ctx.attestation?.valid === true && ctx.attestation.expiry > Math.floor(Date.now() / 1000);
    checks.push({
      name: "verified",
      passed: attested,
      detail: attested
        ? `verifier attestation valid until ${ctx.attestation!.expiry}`
        : `policy requires a human-verified supplier for ${ctx.card.capability}: ${ctx.attestation?.reason ?? "no verifier attestation on file"} (ENS mandi:verified=${ctx.card.verified} is ignored)`,
    });
  }

  const failed = checks.filter((c) => !c.passed);
  return {
    status: failed.length === 0 ? "approved" : "rejected",
    reasons: failed.length === 0 ? checks.map((c) => `${c.name}: ${c.detail}`) : failed.map((c) => `${c.name}: ${c.detail}`),
    supplier: intent.supplier,
    route: intent.route,
    policyHash: ctx.policyHash,
    priceHbar: price,
    checks,
    ts: Date.now(),
  };
}

export type Payment = {
  settled: boolean;
  fulfilled: boolean;
  txId: string | null;
  hashscan: string | null;
  payer: string | null;
  status: number | null;
  latencyMs: number;
  body: unknown;
  error: string | null;
};

export type IntentOutcome = {
  decision: Decision;
  payment: Payment | null;
  hcsTx: string | null;
  ledger: Ledger;
};

async function anchorDecision(decision: Decision, txId: string | null): Promise<string | null> {
  try {
    return await hcsSubmit({
      type: "DECISION",
      policyHash: decision.policyHash,
      supplier: decision.supplier,
      route: decision.route,
      status: decision.status,
      reasons: decision.reasons,
      priceHbar: decision.priceHbar,
      txId,
    });
  } catch (err) {
    console.error(`decision not anchored: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function pay(active: ActivePolicy, decision: Decision, card: ServiceCard, protocol: string): Promise<Payment> {
  const cap = Math.min(parseHbar(active.policy.maxPerCall), parseHbar(active.policy.budgetTotal) - active.ledger.spentHbar);
  const url = new URL(card.endpoint + (decision.route === "/assess/deep" ? "/deep" : ""));
  url.searchParams.set("protocol", protocol);
  const started = Date.now();
  try {
    const res = await paidFetch(cap)(url.toString(), {
      headers: { "X-Mandi-Policy-Hash": active.policyHash },
      signal: AbortSignal.timeout(config.upstreamTimeoutMs),
    });
    const header = res.headers.get("PAYMENT-RESPONSE");
    const settlement = header ? decodePaymentResponseHeader(header) : null;
    const settled = settlement?.success === true;
    if (settled) {
      active.ledger.spentHbar = Math.round((active.ledger.spentHbar + decision.priceHbar) * 1e8) / 1e8;
      active.ledger.calls += 1;
    }
    const body = await res.json().catch(() => null);
    return {
      settled,
      fulfilled: res.ok,
      txId: settlement?.transaction || null,
      hashscan: settlement?.transaction ? hashscanTx(settlement.transaction) : null,
      payer: settlement?.payer ?? null,
      status: res.status,
      latencyMs: Date.now() - started,
      body,
      error: res.ok ? null : `supplier responded ${res.status}`,
    };
  } catch (err) {
    return {
      settled: false,
      fulfilled: false,
      txId: null,
      hashscan: null,
      payer: null,
      status: null,
      latencyMs: Date.now() - started,
      body: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type Lookups = {
  reliability: (name: string) => Promise<Reliability | null>;
  attestation: (name: string) => Promise<Attestation | null>;
};

export const lookups: Lookups = {
  reliability: async () => null,
  attestation: async () => null,
};

export async function evaluateIntent(intent: PurchaseIntent): Promise<{ active: ActivePolicy; card: ServiceCard; decision: Decision }> {
  const active = getActivePolicy(intent.policyHash);
  if (!active) throw new Error(`no active policy ${intent.policyHash}`);
  const card = await resolveService(intent.supplier);
  const [reliability, attestation] = await Promise.all([lookups.reliability(card.name), lookups.attestation(card.name)]);
  const decision = decide(intent, {
    card,
    policy: active.policy,
    policyHash: active.policyHash,
    ledger: active.ledger,
    reliability,
    attestation,
  });
  return { active, card, decision };
}

export async function executeIntent(intent: PurchaseIntent): Promise<IntentOutcome> {
  const { active, card, decision } = await evaluateIntent(intent);
  if (decision.status !== "approved") {
    const hcsTx = await anchorDecision(decision, null);
    return { decision, payment: null, hcsTx, ledger: active.ledger };
  }
  const payment = await pay(active, decision, card, intent.protocol);
  const hcsTx = await anchorDecision(decision, payment.txId);
  return { decision, payment, hcsTx, ledger: active.ledger };
}
