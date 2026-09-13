import { describe, expect, it } from "vitest";
import { planTask, rank, run, type AgentDeps } from "../src/buyer/agent";
import { decide, type Attestation, type IntentOutcome, type Reliability } from "../src/buyer/executor";
import type { ActivePolicy } from "../src/buyer/policy";
import { SAMPLE_POLICY, type Policy, type PurchaseIntent, type ServiceCard } from "../src/types";

const card = (label: string, price: string, verified: boolean): ServiceCard => ({
  name: `${label}.mandi.eth`,
  endpoint: `http://localhost:3000/s/${label}/assess`,
  agentContext: label,
  capability: "financial-risk",
  price,
  chain: "hedera:testnet",
  verified,
});

const cards = {
  basic: card("risk-basic", "0.02 HBAR", false),
  pro: card("risk-pro", "0.05 HBAR", true),
  pro2: card("risk-pro-2", "0.04 HBAR", true),
};

function active(policy: Policy): ActivePolicy {
  return {
    policy,
    policyHash: "b".repeat(64),
    signer: "0x0000000000000000000000000000000000000001",
    signature: "0x00",
    expiry: Math.floor(Date.now() / 1000) + 3600,
    activatedAt: Date.now(),
    hcsTx: null,
    anchorError: null,
    ledger: { spentHbar: 0, calls: 0 },
  };
}

type Options = {
  policy: Policy;
  reliability?: Record<string, Reliability>;
  attestations?: string[];
  failing?: string[];
  throwing?: string[];
};

function deps(opts: Options): { deps: AgentDeps; paid: string[] } {
  const entry = active(opts.policy);
  const paid: string[] = [];
  const all = Object.values(cards);
  const reliabilityOf = async (name: string) => opts.reliability?.[name] ?? null;
  const attestationOf = (name: string): Attestation | null =>
    opts.attestations?.includes(name) ? { valid: true, expiry: Math.floor(Date.now() / 1000) + 3600 } : null;
  return {
    paid,
    deps: {
      policy: () => entry,
      directory: async () => all.map((c) => c.name),
      resolve: async (name) => all.find((c) => c.name === name)!,
      reliability: reliabilityOf,
      attestation: async (name) => attestationOf(name),
      execute: async (intent: PurchaseIntent): Promise<IntentOutcome> => {
        const c = all.find((x) => x.name === intent.supplier)!;
        if (opts.throwing?.includes(c.name)) throw new Error(`${c.name} could not be reached`);
        const decision = decide(intent, {
          card: c,
          policy: entry.policy,
          policyHash: entry.policyHash,
          ledger: entry.ledger,
          reliability: await reliabilityOf(c.name),
          attestation: attestationOf(c.name),
        });
        if (decision.status !== "approved") return { decision, payment: null, hcsTx: null, ledger: entry.ledger };
        const fulfilled = !opts.failing?.includes(c.name);
        paid.push(c.name);
        entry.ledger.spentHbar += decision.priceHbar;
        entry.ledger.calls += 1;
        return {
          decision,
          payment: {
            settled: fulfilled,
            fulfilled,
            txId: fulfilled ? `0.0.1@${paid.length}` : null,
            hashscan: null,
            payer: "0.0.1",
            status: fulfilled ? 200 : 504,
            latencyMs: 5,
            body: fulfilled ? { riskScore: 42 } : null,
            error: fulfilled ? null : "supplier responded 504",
          },
          hcsTx: null,
          ledger: entry.ledger,
        };
      },
    },
  };
}

async function collect(opts: Options) {
  const d = deps(opts);
  const events = [];
  for await (const ev of run("Assess risk of Aave", "b".repeat(64), d.deps)) events.push(ev);
  return { events, paid: d.paid, done: events.at(-1)! };
}

describe("planTask", () => {
  it("maps a risk task to financial-risk and extracts the protocol", () => {
    expect(planTask("Assess risk of Aave")).toMatchObject({ capability: "financial-risk", protocol: "aave", route: "/assess" });
    expect(planTask("deep risk check on compound").route).toBe("/assess/deep");
  });
});

describe("rank", () => {
  it("prefers verified, then success rate, then price", () => {
    const ranked = rank([
      { card: cards.basic, reliability: { calls: 10, fulfilled: 10, failed: 0, successRate: 1, sampleSize: 10 }, attested: false },
      { card: cards.pro, reliability: { calls: 10, fulfilled: 9, failed: 1, successRate: 0.9, sampleSize: 10 }, attested: true },
      { card: cards.pro2, reliability: null, attested: true },
    ]).map((c) => c.card.name);
    expect(ranked).toEqual([cards.pro.name, cards.pro2.name, cards.basic.name]);
  });
});

describe("run", () => {
  const open: Policy = { ...SAMPLE_POLICY, requireVerifiedFor: [] };

  it("picks the cheapest eligible supplier under a tight cap", async () => {
    const { done, paid } = await collect({ policy: { ...open, maxPerCall: "0.03 HBAR" } });
    expect(done.outcome).toBe("FULFILLED");
    expect(done.supplier).toBe(cards.basic.name);
    expect(paid).toEqual([cards.basic.name]);
  });

  const strong: Reliability = { calls: 20, fulfilled: 20, failed: 0, successRate: 1, sampleSize: 20 };

  it("picks the verified supplier when the policy requires accreditation", async () => {
    const { events, done, paid } = await collect({
      policy: SAMPLE_POLICY,
      attestations: [cards.pro.name, cards.pro2.name],
      reliability: { [cards.pro.name]: strong },
    });
    expect(done.supplier).toBe(cards.pro.name);
    expect(paid).toEqual([cards.pro.name]);
    const auths = events.filter((e) => e.stage === "authorization");
    expect(auths).toHaveLength(1);
  });

  it("falls back to the next eligible supplier after a failed call", async () => {
    const { events, done, paid } = await collect({
      policy: SAMPLE_POLICY,
      attestations: [cards.pro.name, cards.pro2.name],
      reliability: { [cards.pro.name]: strong },
      failing: [cards.pro.name],
    });
    expect(paid).toEqual([cards.pro.name, cards.pro2.name]);
    expect(done.outcome).toBe("FULFILLED");
    expect(done.supplier).toBe(cards.pro2.name);
    expect(events.filter((e) => e.stage === "receipt").map((e) => e.fulfilled)).toEqual([false, true]);
    expect((done.ledger as { spentHbar: number }).spentHbar).toBeCloseTo(0.09);
  });

  it("refuses when no supplier can satisfy the policy", async () => {
    const low: Reliability = { calls: 10, fulfilled: 9, failed: 1, successRate: 0.9, sampleSize: 10 };
    const { events, done, paid } = await collect({
      policy: { ...open, minSuccessRate: 0.99 },
      reliability: { [cards.basic.name]: low, [cards.pro.name]: low, [cards.pro2.name]: low },
    });
    expect(paid).toEqual([]);
    expect(done.outcome).toBe("NO_ELIGIBLE_SUPPLIER");
    expect((done.rejections as unknown[]).length).toBe(3);
    expect(events.some((e) => e.stage === "payment")).toBe(false);
  });

  it("keeps going when one supplier's execution throws", async () => {
    const { done, paid, events } = await collect({ policy: open, throwing: [cards.basic.name] });
    expect(paid).toEqual([cards.pro2.name]);
    expect(done.outcome).toBe("FULFILLED");
    expect(events.some((e) => e.stage === "authorization" && typeof e.error === "string")).toBe(true);
  });

  it("reports every supplier that could not be reached", async () => {
    const { done } = await collect({ policy: open, throwing: Object.values(cards).map((c) => c.name) });
    expect(done.outcome).toBe("NO_ELIGIBLE_SUPPLIER");
    expect((done.rejections as { reasons: string[] }[]).every((r) => r.reasons[0]!.startsWith("execution:"))).toBe(true);
  });

  it("stops after a failure when fallback is disabled", async () => {
    const { done, paid } = await collect({ policy: { ...open, fallbackOnFailure: false }, failing: [cards.basic.name] });
    expect(paid).toEqual([cards.basic.name]);
    expect(done.outcome).toBe("FAILED_NO_FALLBACK");
  });
});
