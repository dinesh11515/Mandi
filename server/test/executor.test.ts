import { describe, expect, it } from "vitest";
import { acceptFilter, decide, type DecisionContext } from "../src/buyer/executor";
import { SAMPLE_POLICY, type ServiceCard } from "../src/types";

const card: ServiceCard = {
  name: "risk-pro.mandi.eth",
  endpoint: "http://localhost:3000/s/risk-pro/assess",
  agentContext: "pro",
  capability: "financial-risk",
  price: "0.05 HBAR",
  chain: "hedera:testnet",
  verified: false,
};

const intent = { supplier: card.name, route: "/assess" };

function ctx(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    card,
    policy: { ...SAMPLE_POLICY, requireVerifiedFor: [] },
    policyHash: "a".repeat(64),
    ledger: { spentHbar: 0, calls: 0 },
    reliability: null,
    attestation: null,
    ...overrides,
  };
}

describe("decide", () => {
  it("approves when every check passes", () => {
    const d = decide(intent, ctx());
    expect(d.status).toBe("approved");
    expect(d.priceHbar).toBe(0.05);
    expect(d.checks.every((c) => c.passed)).toBe(true);
  });

  it("rejects an over-cap price with a readable reason", () => {
    const d = decide(intent, ctx({ policy: { ...SAMPLE_POLICY, requireVerifiedFor: [], maxPerCall: "0.03 HBAR" } }));
    expect(d.status).toBe("rejected");
    expect(d.reasons).toEqual(["price-cap: advertised 0.05 HBAR vs maxPerCall 0.03 HBAR"]);
  });

  it("rejects when the remaining budget is too small", () => {
    const d = decide(intent, ctx({ ledger: { spentHbar: 0.97, calls: 20 } }));
    expect(d.status).toBe("rejected");
    expect(d.reasons[0]).toContain("budget: needs 0.05 HBAR, 0.03 HBAR of 1 HBAR remaining");
  });

  it("rejects below minSuccessRate and names the sample size", () => {
    const d = decide(intent, ctx({ reliability: { calls: 10, fulfilled: 9, failed: 1, successRate: 0.9, sampleSize: 10 } }));
    expect(d.status).toBe("rejected");
    expect(d.reasons[0]).toContain("success rate 90.0% over 10 settled calls vs minSuccessRate 95%");
  });

  it("does not enforce minSuccessRate without history", () => {
    const d = decide(intent, ctx({ reliability: { calls: 0, fulfilled: 0, failed: 0, successRate: null, sampleSize: 0 } }));
    expect(d.status).toBe("approved");
    expect(d.checks.find((c) => c.name === "reliability")?.detail).toContain("sample size 0");
  });

  it("requires a verifier attestation for financial capabilities and ignores the ENS flag", () => {
    const flagged = { ...card, verified: true };
    const d = decide(intent, ctx({ card: flagged, policy: SAMPLE_POLICY }));
    expect(d.status).toBe("rejected");
    expect(d.reasons[0]).toContain("no verifier attestation on file");
    expect(d.reasons[0]).toContain("mandi:verified=true is ignored");
    const ok = decide(intent, ctx({ card: flagged, policy: SAMPLE_POLICY, attestation: { valid: true, expiry: Math.floor(Date.now() / 1000) + 60 } }));
    expect(ok.status).toBe("approved");
  });

  it("rejects a name that resolves to a different chain", () => {
    const d = decide(intent, ctx({ card: { ...card, chain: "eip155:1" } }));
    expect(d.status).toBe("rejected");
    expect(d.reasons[0]).toMatch(/^identity:/);
  });
});

describe("acceptFilter", () => {
  const req = (amount: string, asset = "0.0.0", network = "hedera:testnet") =>
    ({ scheme: "exact", network, asset, amount, payTo: "0.0.1", maxTimeoutSeconds: 60, extra: {} }) as never;

  it("keeps only HBAR requirements on hedera:testnet at or under the cap", () => {
    const filter = acceptFilter(0.05);
    const kept = filter([req("5000000"), req("5000001"), req("1000", "0.0.429274"), req("1000", "0.0.0", "hedera:mainnet")]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.amount).toBe("5000000");
  });

  it("keeps every HBAR requirement when the cap is infinite", () => {
    const kept = acceptFilter(Number.POSITIVE_INFINITY)([req("5000000"), req("99999999999")]);
    expect(kept).toHaveLength(2);
  });
});
