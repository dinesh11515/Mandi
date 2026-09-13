import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it } from "vitest";
import {
  activatePolicy,
  canonicalize,
  describeActivation,
  forgetPolicies,
  getActivePolicy,
  mandateMessage,
  policyHash,
  runTokenMatches,
} from "../src/buyer/policy";
import { PolicySchema, SAMPLE_POLICY, type Policy } from "../src/types";

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
  const human = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const now = () => Math.floor(Date.now() / 1000);
  const fresh = () => now() + 24 * 60 * 60;

  const sign = (policy: Policy, expiry: number, account = human) =>
    account.signMessage({ message: mandateMessage(policyHash(policy), expiry) });

  async function activate(policy: Policy, expiry = fresh(), account = human) {
    return activatePolicy({ policy, expiry, signature: await sign(policy, expiry, account), signer: account.address });
  }

  beforeEach(() => {
    forgetPolicies();
  });

  it("refuses to activate without a wallet signature", async () => {
    await expect(activatePolicy({ policy: SAMPLE_POLICY })).rejects.toThrow("sign the mandate with a wallet");
    const expiry = fresh();
    await expect(activatePolicy({ policy: SAMPLE_POLICY, expiry, signer: human.address })).rejects.toThrow(
      "sign the mandate with a wallet",
    );
    await expect(
      activatePolicy({ policy: SAMPLE_POLICY, expiry, signature: await sign(SAMPLE_POLICY, expiry) }),
    ).rejects.toThrow("sign the mandate with a wallet");
  });

  it("stores the wallet mandate and issues a run token", async () => {
    const entry = await activate(SAMPLE_POLICY);
    expect(entry.signer).toBe(human.address);
    expect(entry.policyHash).toBe(policyHash(SAMPLE_POLICY));
    expect(entry.runToken).toMatch(/^[0-9a-f]{64}$/);
    expect(getActivePolicy(entry.policyHash)?.ledger).toEqual({ spentHbar: 0, calls: 0 });
  });

  it("never describes the signature or the run token", async () => {
    const described = describeActivation(await activate(SAMPLE_POLICY)) as Record<string, unknown>;
    expect("signature" in described).toBe(false);
    expect("runToken" in described).toBe(false);
  });

  it("rejects a stale expiry and one that reaches too far ahead", async () => {
    await expect(activate(SAMPLE_POLICY, 1)).rejects.toThrow("stale");
    await expect(activate(SAMPLE_POLICY, now() + 24 * 60 * 60 - 901)).rejects.toThrow("stale");
    await expect(activate(SAMPLE_POLICY, now() + 24 * 60 * 60 + 121)).rejects.toThrow("too far ahead");
    await expect(activate(SAMPLE_POLICY, now() + 7 * 24 * 60 * 60)).rejects.toThrow("too far ahead");
  });

  it("rejects a replayed signature", async () => {
    const expiry = fresh();
    const signature = await sign(SAMPLE_POLICY, expiry);
    await expect(activatePolicy({ policy: SAMPLE_POLICY, expiry, signature, signer: human.address })).resolves.toBeTruthy();
    await expect(activatePolicy({ policy: SAMPLE_POLICY, expiry, signature, signer: human.address })).rejects.toThrow(
      "mandate already used",
    );
  });

  it("keeps the ledger and the run token when the same signer activates again", async () => {
    const first = await activate(SAMPLE_POLICY);
    first.ledger.spentHbar = 0.05;
    first.ledger.calls = 1;
    const again = await activate(SAMPLE_POLICY, fresh() - 1);
    expect(again.runToken).toBe(first.runToken);
    expect(again.ledger).toEqual({ spentHbar: 0.05, calls: 1 });
  });

  it("rejects another signer taking over an active policy", async () => {
    const first = await activate(SAMPLE_POLICY);
    await expect(activate(SAMPLE_POLICY, fresh() - 2, other)).rejects.toThrow("different signer");
    expect(getActivePolicy(first.policyHash)?.signer).toBe(human.address);
  });

  it("rejects a malformed policy", async () => {
    await expect(activatePolicy({ policy: { ...SAMPLE_POLICY, budgetTotal: 1 } })).rejects.toThrow();
  });

  it("rejects a signature from a different signer", async () => {
    const expiry = fresh();
    const signature = await sign(SAMPLE_POLICY, expiry, other);
    await expect(activatePolicy({ policy: SAMPLE_POLICY, expiry, signature, signer: human.address })).rejects.toThrow(
      "does not match",
    );
    await expect(activatePolicy({ policy: SAMPLE_POLICY, expiry, signature, signer: other.address })).resolves.toBeTruthy();
  });

  it("matches only the run token it issued", async () => {
    const entry = await activate(SAMPLE_POLICY);
    expect(runTokenMatches(entry, entry.runToken)).toBe(true);
    expect(runTokenMatches(entry, entry.runToken.toUpperCase())).toBe(false);
    expect(runTokenMatches(entry, `0${entry.runToken.slice(1)}`)).toBe(false);
    expect(runTokenMatches(entry, undefined)).toBe(false);
    expect(runTokenMatches(entry, "")).toBe(false);
    expect(runTokenMatches(entry, entry.policyHash)).toBe(false);
  });
});
