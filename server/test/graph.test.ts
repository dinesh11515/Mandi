import { describe, expect, it } from "vitest";
import { SUBGRAPHS, parseMetrics, queriesFor, score } from "../src/market/graph";

const aave = SUBGRAPHS.aave!;

describe("queriesFor", () => {
  it("runs one query for basic and three for pro", () => {
    expect(queriesFor("lending", "basic", false)).toHaveLength(1);
    expect(queriesFor("lending", "pro", false)).toHaveLength(3);
    expect(queriesFor("lending", "pro", true)[1]).toContain("first: 30");
  });
});

describe("parseMetrics + score", () => {
  const protocolRow = (tvl: string, deposit: string, borrow: string) => ({
    lendingProtocols: [{ name: "Aave v3", totalValueLockedUSD: tvl, totalDepositBalanceUSD: deposit, totalBorrowBalanceUSD: borrow }],
  });

  it("scores a large, lightly utilized protocol as low risk with raw numbers in notes", () => {
    const m = parseMetrics("aave", aave, [protocolRow("12000000000", "15000000000", "6000000000")]);
    expect(m.utilization).toBeCloseTo(0.4);
    const s = score(m);
    expect(s.riskScore).toBe(10);
    expect(s.liquidityRisk).toBe("low");
    expect(s.notes.join("\n")).toContain("tvl=$12,000,000,000");
    expect(s.notes.join("\n")).toContain("utilization=40.0%");
  });

  it("scores a small, highly utilized, shrinking protocol as high risk", () => {
    const m = parseMetrics("aave", aave, [
      protocolRow("50000000", "60000000", "57000000"),
      { financialsDailySnapshots: [
        { timestamp: "200", totalValueLockedUSD: "50000000", dailyLiquidateUSD: "400000" },
        { timestamp: "100", totalValueLockedUSD: "80000000", dailyLiquidateUSD: "0" },
      ] },
      { usageMetricsDailySnapshots: [{ dailyActiveUsers: "12" }] },
    ]);
    expect(m.tvlChange).toBeCloseTo(-0.375);
    const s = score(m);
    expect(s.riskScore).toBe(100);
    expect(s.liquidityRisk).toBe("high");
    expect(s.notes.some((n) => n.startsWith("daily liquidations="))).toBe(true);
  });

  it("handles the generic schema without utilization", () => {
    const m = parseMetrics("lido", SUBGRAPHS.lido!, [{ protocols: [{ name: "Lido", totalValueLockedUSD: "25000000000" }] }]);
    expect(m.utilization).toBeNull();
    expect(score(m)).toMatchObject({ riskScore: 10, liquidityRisk: "low" });
  });
});
