import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";
import { activatePolicy, canonicalize, getActivePolicy, mandateMessage, policyHash } from "../src/buyer/policy";
import { PolicySchema, SAMPLE_POLICY } from "../src/types";

describe("PolicySchema", () => {
  it("parses the sample policy", () => {
    expect(PolicySchema.parse(SAMPLE_POLICY)).toEqual(SAMPLE_POLICY);
  });

  it("rejects a malformed policy", () => {
    expect(PolicySchema.safeParse({ ...SAMPLE_POLICY, minSuccessRate: 1.5 }).success).toBe(false);
    expect(PolicySchema.safeParse({ ...SAMPLE_POLICY, budgetTotal: "1" }).success).toBe(false);
    const { budgetTotal: _dropped, ...missing } = SAMPLE_POLICY;
    expect(PolicySchema.safeParse(missing).success).toBe(false);
    expect(PolicySchema.safeParse({ ...SAMPLE_POLICY, extra: true }).success).toBe(false);
  });
});

describe("policyHash", () => {
  it("is independent of key order", () => {
    const reordered = {
      fallbackOnFailure: SAMPLE_POLICY.fallbackOnFailure,
      minSuccessRate: SAMPLE_POLICY.minSuccessRate,
      requireVerifiedFor: SAMPLE_POLICY.requireVerifiedFor,
      maxPerCall: SAMPLE_POLICY.maxPerCall,
      budgetTotal: SAMPLE_POLICY.budgetTotal,
    };
    expect(canonicalize(reordered)).toBe(canonicalize(SAMPLE_POLICY));
    expect(policyHash(reordered)).toBe(policyHash(SAMPLE_POLICY));
  });

  it("changes when a value changes", () => {
    expect(policyHash({ ...SAMPLE_POLICY, minSuccessRate: 0.99 })).not.toBe(policyHash(SAMPLE_POLICY));
  });
});

describe("activatePolicy", () => {
  const humanKey = generatePrivateKey();
  beforeAll(() => {
    process.env.HUMAN_KEY = humanKey;
  });

  it("signs with the human key and stores the mandate", async () => {
    const entry = await activatePolicy({ policy: SAMPLE_POLICY });
    expect(entry.signer).toBe(privateKeyToAccount(humanKey).address);
    expect(entry.policyHash).toBe(policyHash(SAMPLE_POLICY));
    expect(getActivePolicy(entry.policyHash)?.ledger).toEqual({ spentHbar: 0, calls: 0 });
  });

  it("rejects an expired mandate", async () => {
    await expect(activatePolicy({ policy: SAMPLE_POLICY, expiry: 1 })).rejects.toThrow("expired");
  });

  it("rejects a malformed policy", async () => {
    await expect(activatePolicy({ policy: { ...SAMPLE_POLICY, budgetTotal: 1 } })).rejects.toThrow();
  });

  it("rejects a signature from a different signer", async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const hash = policyHash(SAMPLE_POLICY);
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const signature = await other.signMessage({ message: mandateMessage(hash, expiry) });
    await expect(
      activatePolicy({ policy: SAMPLE_POLICY, expiry, signature, signer: privateKeyToAccount(humanKey).address }),
    ).rejects.toThrow("does not match");
    await expect(activatePolicy({ policy: SAMPLE_POLICY, expiry, signature, signer: other.address })).resolves.toBeTruthy();
  });
});
