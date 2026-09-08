import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { config, requireEnv } from "../config";
import { resolveService } from "../ens";
import { parseHbar } from "../hbar";
import type { Check, Decision, Policy, PurchaseIntent, ServiceCard } from "../types";
import { getActivePolicy, type Ledger } from "./policy";

function buyerKey(): PrivateKey {
  const raw = requireEnv("BUYER_KEY");
  if (raw.startsWith("0x")) return PrivateKey.fromStringECDSA(raw);
  if (raw.startsWith("30")) return PrivateKey.fromStringDer(raw);
  return PrivateKey.fromString(raw);
}

let paid: typeof fetch | undefined;

export function paidFetch(): typeof fetch {
  if (!paid) {
    const signer = createClientHederaSigner(requireEnv("BUYER_ACCOUNT_ID"), buyerKey(), {
      network: config.x402.network,
    });
    const client = x402Client.fromConfig({
      schemes: [{ network: "hedera:*", client: new ExactHederaScheme(signer) }],
      spendControls: false,
    });
    paid = wrapFetchWithPayment(fetch, client);
  }
  return paid;
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

export async function evaluateIntent(intent: PurchaseIntent): Promise<Decision> {
  const active = getActivePolicy(intent.policyHash);
  if (!active) throw new Error(`no active policy ${intent.policyHash}`);
  const card = await resolveService(intent.supplier);
  return decide(intent, {
    card,
    policy: active.policy,
    policyHash: active.policyHash,
    ledger: active.ledger,
    reliability: null,
    attestation: null,
  });
}
