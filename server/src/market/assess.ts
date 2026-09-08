import type { Depth } from "../config";
import { fetchMetrics, graphEnabled, score, subgraphFor } from "./graph";

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

function bucket(value: number): Assessment["liquidityRisk"] {
  if (value < 34) return "low";
  if (value < 67) return "medium";
  return "high";
}

function placeholder(protocol: string, depth: Depth, deep: boolean, reason: string): Assessment {
  const metrics = depth === "pro" ? ["tvl", "utilization", "liquidity"] : ["tvl"];
  if (deep) metrics.push("volatility30d");
  const riskScore = Math.round(20 + seed(protocol) * 60);
  return {
    riskScore,
    liquidityRisk: bucket(riskScore),
    notes: [`protocol=${protocol}`, `metrics=${metrics.join(",")}`, `placeholder score: ${reason}`],
  };
}

export async function assess(protocol: string, depth: Depth, deep: boolean): Promise<Assessment> {
  if (!graphEnabled()) return placeholder(protocol, depth, deep, "GRAPH_API_KEY not configured");
  if (!subgraphFor(protocol)) return placeholder(protocol, depth, deep, `no Messari subgraph mapped for ${protocol}`);
  return score(await fetchMetrics(protocol, depth, deep));
}
