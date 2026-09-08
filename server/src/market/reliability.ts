import { config } from "../config";
import { parseHbar } from "../hbar";
import { hashscanTopic, mirrorMessages, type HcsMessage } from "../hedera";

export type SupplierReliability = {
  supplier: string;
  calls: number;
  fulfilled: number;
  failed: number;
  settled: number;
  successRate: number | null;
  sampleSize: number;
  avgCostHbar: number | null;
  avgLatencyMs: number | null;
  lastActive: number | null;
};

export function emptyReliability(supplier: string): SupplierReliability {
  return {
    supplier,
    calls: 0,
    fulfilled: 0,
    failed: 0,
    settled: 0,
    successRate: null,
    sampleSize: 0,
    avgCostHbar: null,
    avgLatencyMs: null,
    lastActive: null,
  };
}

export function aggregate(messages: HcsMessage[]): Map<string, SupplierReliability> {
  const totals = new Map<string, SupplierReliability & { cost: number; latency: number; latencySamples: number }>();
  for (const m of messages) {
    if (m.type !== "RECEIPT" || typeof m.supplier !== "string") continue;
    const entry = totals.get(m.supplier) ?? { ...emptyReliability(m.supplier), cost: 0, latency: 0, latencySamples: 0 };
    entry.calls += 1;
    if (m.fulfilled === true) entry.fulfilled += 1;
    else entry.failed += 1;
    if (m.settled === true) {
      entry.settled += 1;
      if (typeof m.amountHbar === "string") entry.cost += parseHbar(m.amountHbar);
    }
    if (typeof m.latencyMs === "number") {
      entry.latency += m.latencyMs;
      entry.latencySamples += 1;
    }
    if (typeof m.ts === "number") entry.lastActive = Math.max(entry.lastActive ?? 0, m.ts);
    totals.set(m.supplier, entry);
  }
  const out = new Map<string, SupplierReliability>();
  for (const [supplier, t] of totals) {
    const { cost, latency, latencySamples, ...rest } = t;
    out.set(supplier, {
      ...rest,
      successRate: t.calls > 0 ? t.fulfilled / t.calls : null,
      sampleSize: t.calls,
      avgCostHbar: t.settled > 0 ? Math.round((cost / t.settled) * 1e8) / 1e8 : null,
      avgLatencyMs: latencySamples > 0 ? Math.round(latency / latencySamples) : null,
    });
  }
  return out;
}

let cache: { at: number; index: Map<string, SupplierReliability> } | undefined;

export async function reliabilityIndex(): Promise<Map<string, SupplierReliability>> {
  if (!cache || Date.now() - cache.at > 10_000) {
    cache = { at: Date.now(), index: aggregate(await mirrorMessages()) };
  }
  return cache.index;
}

export async function reliabilityFor(label: string): Promise<SupplierReliability> {
  return (await reliabilityIndex()).get(label) ?? emptyReliability(label);
}

export function reliabilitySource() {
  return {
    topicId: config.hedera.topicId || null,
    hashscan: config.hedera.topicId ? hashscanTopic(config.hedera.topicId) : null,
    derivedFrom: "RECEIPT messages on the HCS topic; proves calls, failures, latency and cost, never correctness",
  };
}
