import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { acceptFilter, decide, executeIntent, lookups, type DecisionContext, type Payment } from "../src/buyer/executor";
import { activatePolicy, forgetPolicies, mandateMessage, policyHash } from "../src/buyer/policy";
import { SAMPLE_POLICY, type Policy, type ServiceCard } from "../src/types";

const card: ServiceCard = {
  name: "risk-pro.mandi.eth",
  endpoint: "http://localhost:3000/s/risk-pro/assess",
  agentContext: "pro",
  capability: "financial-risk",
  price: "0.05 HBAR",
  chain: "hedera:testnet",
  verified: false,
};

const intent = { supplier: card.name, route: "/assess" } as const;

const SIGNER = "0x0000000000000000000000000000000000000001";
const EXECUTOR = "0.0.10454930";

function ctx(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    card,
    policy: { ...SAMPLE_POLICY, requireVerifiedFor: [] },
    policyHash: "a".repeat(64),
    signer: SIGNER,
    ledger: { spentHbar: 0, calls: 0 },
    reliability: null,
    attestation: null,
    funding: { depositedHbar: 5, spentHbar: 0, availableHbar: 5 },
    ...overrides,
  };
}

beforeAll(() => {
  process.env.BUYER_ACCOUNT_ID = EXECUTOR;
});

afterEach(() => {
  delete process.env.MANDI_UNFUNDED_OK;
});

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
    expect(d.reasons[0]).toContain("success rate 90.0% over 10 anchored calls vs minSuccessRate 95%");
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

describe("the funding check", () => {
  it("passes when the signer has deposited more than the price", () => {
    const d = decide(intent, ctx());
    expect(d.status).toBe("approved");
    expect(d.checks.find((c) => c.name === "funding")?.detail).toBe(
      `deposited 5 HBAR, spent 0 HBAR, 5 HBAR available for ${SIGNER}`,
    );
  });

  it("rejects when the deposit is already spent", () => {
    const d = decide(intent, ctx({ funding: { depositedHbar: 0.5, spentHbar: 0.48, availableHbar: 0.02 } }));
    expect(d.status).toBe("rejected");
    expect(d.reasons).toEqual([`funding: deposited 0.5 HBAR, spent 0.48 HBAR, 0.02 HBAR available for ${SIGNER}`]);
  });

  it("names the executor account when the signer has deposited nothing", () => {
    const d = decide(intent, ctx({ funding: { depositedHbar: 0, spentHbar: 0, availableHbar: 0 } }));
    expect(d.status).toBe("rejected");
    expect(d.reasons).toEqual([`funding: no HBAR deposited by ${SIGNER} to the executor ${EXECUTOR}`]);
  });

  it("rejects when the mirror node lookup failed", () => {
    const d = decide(intent, ctx({ funding: null }));
    expect(d.status).toBe("rejected");
    expect(d.reasons[0]).toContain("could not be read from the mirror node");
  });

  it("is bypassed by MANDI_UNFUNDED_OK", () => {
    process.env.MANDI_UNFUNDED_OK = "1";
    const d = decide(intent, ctx({ funding: null }));
    expect(d.status).toBe("approved");
    expect(d.checks.find((c) => c.name === "funding")?.detail).toBe("funding check bypassed by MANDI_UNFUNDED_OK");
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

describe("executeIntent", () => {
  const policy: Policy = { ...SAMPLE_POLICY, requireVerifiedFor: [], budgetTotal: "1 HBAR" };

  async function activate() {
    const account = privateKeyToAccount(generatePrivateKey());
    const expiry = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    const signature = await account.signMessage({ message: mandateMessage(policyHash(policy), expiry) });
    return activatePolicy({ policy, expiry, signature, signer: account.address });
  }

  const payment = (settled: boolean): Payment => ({
    settled,
    fulfilled: settled,
    txId: settled ? "0.0.1@1" : null,
    hashscan: null,
    payer: "0.0.1",
    status: settled ? 200 : 402,
    latencyMs: 1,
    body: null,
    error: null,
  });

  afterEach(() => {
    forgetPolicies();
    lookups.funding = async () => null;
    lookups.resolve = async () => {
      throw new Error("not stubbed");
    };
    lookups.pay = async () => payment(false);
  });

  it("serializes two concurrent runs for the same signer so one deposit is spent once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const entry = await activate();
    const deposited = 0.05;
    let spent = 0;
    let inFlight = 0;
    let overlapped = false;
    lookups.resolve = async () => card;
    lookups.funding = async () => {
      inFlight += 1;
      overlapped ||= inFlight > 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight -= 1;
      return { depositedHbar: deposited, spentHbar: spent, availableHbar: Math.round((deposited - spent) * 1e8) / 1e8 };
    };
    lookups.pay = async (active, decision) => {
      spent = Math.round((spent + decision.priceHbar) * 1e8) / 1e8;
      active.ledger.spentHbar = spent;
      active.ledger.calls += 1;
      return payment(true);
    };
    const intent = { supplier: card.name, route: "/assess", protocol: "aave", policyHash: entry.policyHash } as const;
    const outcomes = await Promise.all([executeIntent({ ...intent }), executeIntent({ ...intent })]);
    expect(overlapped).toBe(false);
    expect(outcomes.map((o) => o.decision.status)).toEqual(["approved", "rejected"]);
    expect(outcomes.filter((o) => o.payment?.settled).length).toBe(1);
    expect(outcomes[1]!.decision.reasons[0]).toContain("0 HBAR available");
    expect(entry.ledger).toEqual({ spentHbar: 0.05, calls: 1 });
    vi.restoreAllMocks();
  });

  it("refuses an intent for a policy that is not active", async () => {
    await expect(
      executeIntent({ supplier: card.name, route: "/assess", protocol: "aave", policyHash: "c".repeat(64) }),
    ).rejects.toThrow("no active policy");
  });
});
