import { describe, expect, it } from "vitest";
import type { HcsMessage } from "../src/hedera";
import { aggregate } from "../src/market/reliability";

const receipt = (supplier: string, fulfilled: boolean, settled: boolean, latencyMs: number, ts: number): HcsMessage => ({
  type: "RECEIPT",
  supplier,
  route: "/assess",
  amountHbar: supplier === "risk-pro" ? "0.05 HBAR" : "0.02 HBAR",
  txId: settled ? `0.0.1@${ts}` : null,
  settled,
  fulfilled,
  latencyMs,
  ts,
  policyHash: null,
});

describe("aggregate", () => {
  it("derives per-supplier reliability from RECEIPT messages only", () => {
    const index = aggregate([
      receipt("risk-pro", true, true, 100, 1000),
      receipt("risk-pro", true, true, 300, 2000),
      receipt("risk-pro", false, false, 8000, 3000),
      receipt("risk-basic", true, true, 50, 1500),
      { type: "DECISION", supplier: "risk-pro", status: "rejected", ts: 4000 },
    ]);
    const pro = index.get("risk-pro")!;
    expect(pro).toMatchObject({ calls: 3, fulfilled: 2, failed: 1, settled: 2, sampleSize: 3, lastActive: 3000 });
    expect(pro.successRate).toBeCloseTo(2 / 3);
    expect(pro.avgCostHbar).toBeCloseTo(0.05);
    expect(pro.avgLatencyMs).toBe(2800);
    expect(index.get("risk-basic")).toMatchObject({ calls: 1, fulfilled: 1, successRate: 1, avgCostHbar: 0.02 });
    expect(index.size).toBe(2);
  });

  it("counts a receipt whose amount is unreadable without losing the whole index", () => {
    const index = aggregate([
      { ...receipt("risk-basic", true, true, 50, 1000), amountHbar: "not an amount" },
      receipt("risk-basic", true, true, 50, 2000),
    ]);
    expect(index.get("risk-basic")).toMatchObject({ calls: 2, settled: 2, avgCostHbar: 0.01 });
  });
});
