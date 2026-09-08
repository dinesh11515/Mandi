import type { Depth } from "../config";

export type Assessment = {
  riskScore: number;
  liquidityRisk: "low" | "medium" | "high";
  notes: string[];
};

function seed(text: string): number {
  let h = 2166136261;
  for (const ch of text.toLowerCase()) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h / 0xffffffff;
}

function bucket(score: number): Assessment["liquidityRisk"] {
  if (score < 34) return "low";
  if (score < 67) return "medium";
  return "high";
}

export async function assess(protocol: string, depth: Depth, deep: boolean): Promise<Assessment> {
  const base = seed(protocol);
  const metrics = depth === "pro" ? ["tvl", "utilization", "liquidity"] : ["tvl"];
  if (deep) metrics.push("volatility30d");
  const riskScore = Math.round(20 + base * 60);
  return {
    riskScore,
    liquidityRisk: bucket(riskScore),
    notes: [
      `protocol=${protocol}`,
      `metrics=${metrics.join(",")}`,
      "static placeholder scores until live subgraph data lands",
    ],
  };
}
