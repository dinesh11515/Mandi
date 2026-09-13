import { describe, expect, it } from "vitest";
import { formatHbar, fromTinybar, parseHbar, toTinybar } from "../src/hbar";
import { HbarAmountSchema } from "../src/types";

describe("formatHbar", () => {
  it("prints an amount the schema and parser both accept", () => {
    for (const value of [0, 0.02, 0.05, 1, 100, 0.0000001]) {
      const printed = formatHbar(value);
      expect(HbarAmountSchema.safeParse(printed).success).toBe(true);
      expect(parseHbar(printed)).toBeCloseTo(value, 8);
    }
  });

  it("does not leak float noise or exponents into receipts", () => {
    expect(formatHbar(0.1 + 0.2)).toBe("0.3 HBAR");
    expect(formatHbar(1e-7)).toBe("0.0000001 HBAR");
    expect(formatHbar(100)).toBe("100 HBAR");
  });

  it("refuses an amount that is not a number", () => {
    expect(() => formatHbar(Number.NaN)).toThrow("invalid HBAR amount");
  });
});

describe("tinybar", () => {
  it("round-trips whole tinybar amounts", () => {
    expect(toTinybar(0.05)).toBe(5_000_000n);
    expect(fromTinybar(5_000_000n)).toBe(0.05);
    expect(fromTinybar("100000000")).toBe(1);
  });
});
