import { describe, expect, it } from "vitest";
import { PolicySchema, SAMPLE_POLICY } from "../src/types";

describe("PolicySchema", () => {
  it("parses the sample policy", () => {
    const parsed = PolicySchema.parse(SAMPLE_POLICY);
    expect(parsed).toEqual({
      budgetTotal: "1 HBAR",
      maxPerCall: "0.05 HBAR",
      requireVerifiedFor: ["financial"],
      minSuccessRate: 0.95,
      fallbackOnFailure: true,
    });
  });

  it("rejects a malformed policy", () => {
    expect(PolicySchema.safeParse({ ...SAMPLE_POLICY, minSuccessRate: 1.5 }).success).toBe(false);
    expect(PolicySchema.safeParse({ ...SAMPLE_POLICY, budgetTotal: "1" }).success).toBe(false);
    expect(
      PolicySchema.safeParse({
        maxPerCall: SAMPLE_POLICY.maxPerCall,
        requireVerifiedFor: SAMPLE_POLICY.requireVerifiedFor,
        minSuccessRate: SAMPLE_POLICY.minSuccessRate,
        fallbackOnFailure: SAMPLE_POLICY.fallbackOnFailure,
      }).success,
    ).toBe(false);
    expect(PolicySchema.safeParse({ ...SAMPLE_POLICY, extra: true }).success).toBe(false);
  });
});
