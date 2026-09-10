import { config, type Depth } from "../config";

export type Subgraph = { id: string; schema: "lending" | "generic"; name: string };

export const SUBGRAPHS: Record<string, Subgraph> = {
  aave: { id: "JCNWRypm7FYwV8fx5HhzZPSFaMxgkPuw4TnR3Gpi81zk", schema: "lending", name: "messari/aave-v3-ethereum" },
  compound: { id: "AwoxEZbiWLvv6e3QdvdMZw4WDURdGbvPfHmZRc8Dpfz9", schema: "lending", name: "messari/compound-v3-ethereum" },
  morpho: { id: "FKe6ANnWmGPE6hajGLoTgPrVF2jYPHiRu2Jwcg9ZmG9A", schema: "lending", name: "messari/morpho-aave-v3-ethereum" },
  lido: { id: "F7qb71hWab6SuRL5sf6LQLTpNahmqMsBnnweYHzLGUyG", schema: "generic", name: "messari/lido-ethereum" },
};

export type Metrics = {
  protocol: string;
  source: Subgraph;
  queries: number;
  tvlUsd: number;
  depositUsd: number | null;
  borrowUsd: number | null;
  utilization: number | null;
  liquidityUsd: number | null;
  tvlChange: number | null;
  tvlWindowDays: number | null;
  dailyLiquidateUsd: number | null;
  dailyActiveUsers: number | null;
};

export function graphEnabled(): boolean {
  return config.graphApiKey.length > 0;
}

export function subgraphFor(protocol: string): Subgraph | undefined {
  return SUBGRAPHS[protocol.toLowerCase()];
}

export function queriesFor(schema: Subgraph["schema"], depth: Depth, deep: boolean): string[] {
  const snapshots = deep ? 30 : 8;
  const protocolQuery =
    schema === "lending"
      ? "{ lendingProtocols(first: 1) { name totalValueLockedUSD totalDepositBalanceUSD totalBorrowBalanceUSD } }"
      : "{ protocols(first: 1) { name totalValueLockedUSD } }";
  if (depth === "basic") return [protocolQuery];
  const liquidations = schema === "lending" ? " dailyLiquidateUSD" : "";
  return [
    protocolQuery,
    `{ financialsDailySnapshots(first: ${snapshots}, orderBy: timestamp, orderDirection: desc) { timestamp totalValueLockedUSD${liquidations} } }`,
    "{ usageMetricsDailySnapshots(first: 1, orderBy: timestamp, orderDirection: desc) { dailyActiveUsers } }",
  ];
}

async function query(subgraph: Subgraph, gql: string): Promise<Record<string, unknown>> {
  const url = `https://gateway.thegraph.com/api/${config.graphApiKey}/subgraphs/id/${subgraph.id}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: gql }),
    signal: AbortSignal.timeout(config.upstreamTimeoutMs),
  });
  if (!res.ok) throw new Error(`subgraph ${subgraph.name} responded ${res.status}`);
  const body = (await res.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`subgraph ${subgraph.name}: ${body.errors.map((e) => e.message).join("; ")}`);
  if (!body.data) throw new Error(`subgraph ${subgraph.name}: empty response`);
  return body.data;
}

const num = (value: unknown): number | null => (value === undefined || value === null ? null : Number(value));

export function parseMetrics(protocol: string, source: Subgraph, results: Record<string, unknown>[]): Metrics {
  const first = results[0] ?? {};
  const protocols = ((first.lendingProtocols ?? first.protocols) as Record<string, unknown>[] | undefined) ?? [];
  const p = protocols[0] ?? {};
  const tvlUsd = num(p.totalValueLockedUSD) ?? 0;
  const depositUsd = num(p.totalDepositBalanceUSD);
  const borrowUsd = num(p.totalBorrowBalanceUSD);
  const utilization = depositUsd && borrowUsd !== null ? borrowUsd / depositUsd : null;
  const snapshots = ((results[1]?.financialsDailySnapshots as Record<string, unknown>[] | undefined) ?? []).filter(Boolean);
  const latest = snapshots[0];
  const oldest = snapshots.at(-1);
  const tvlChange =
    latest && oldest && snapshots.length > 1 && num(oldest.totalValueLockedUSD)
      ? (num(latest.totalValueLockedUSD)! - num(oldest.totalValueLockedUSD)!) / num(oldest.totalValueLockedUSD)!
      : null;
  const usage = ((results[2]?.usageMetricsDailySnapshots as Record<string, unknown>[] | undefined) ?? [])[0];
  return {
    protocol,
    source,
    queries: results.length,
    tvlUsd,
    depositUsd,
    borrowUsd,
    utilization,
    liquidityUsd: depositUsd !== null && borrowUsd !== null ? depositUsd - borrowUsd : null,
    tvlChange,
    tvlWindowDays: snapshots.length > 1 ? snapshots.length : null,
    dailyLiquidateUsd: latest ? num(latest.dailyLiquidateUSD) : null,
    dailyActiveUsers: usage ? num(usage.dailyActiveUsers) : null,
  };
}

export async function fetchMetrics(protocol: string, depth: Depth, deep: boolean): Promise<Metrics> {
  const source = subgraphFor(protocol);
  if (!source) throw new Error(`no subgraph mapped for ${protocol}`);
  const results: Record<string, unknown>[] = [];
  for (const gql of queriesFor(source.schema, depth, deep)) results.push(await query(source, gql));
  return parseMetrics(protocol, source, results);
}

export type Scored = { riskScore: number; liquidityRisk: "low" | "medium" | "high"; notes: string[] };

const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

export function score(m: Metrics): Scored {
  let risk = 10;
  const notes: string[] = [`source=${m.source.name} (${m.source.id}) queries=${m.queries}`, `tvl=${usd(m.tvlUsd)}`];
  if (m.utilization !== null) {
    notes.push(`utilization=${pct(m.utilization)} (borrow ${usd(m.borrowUsd ?? 0)} / deposit ${usd(m.depositUsd ?? 0)})`);
    if (m.utilization >= 0.9) risk += 35;
    else if (m.utilization >= 0.75) risk += 20;
    else if (m.utilization >= 0.5) risk += 10;
  }
  if (m.liquidityUsd !== null) notes.push(`available liquidity=${usd(m.liquidityUsd)}`);
  if (m.tvlUsd < 1e8) risk += 25;
  else if (m.tvlUsd < 1e9) risk += 10;
  if (m.tvlChange !== null) {
    notes.push(`tvl change over ${m.tvlWindowDays} daily snapshots=${pct(m.tvlChange)}`);
    if (m.tvlChange <= -0.2) risk += 20;
    else if (m.tvlChange <= -0.1) risk += 10;
  }
  if (m.dailyLiquidateUsd !== null && m.tvlUsd > 0) {
    const ratio = m.dailyLiquidateUsd / m.tvlUsd;
    notes.push(`daily liquidations=${usd(m.dailyLiquidateUsd)} (${pct(ratio)} of tvl)`);
    if (ratio >= 0.005) risk += 15;
    else if (ratio >= 0.001) risk += 5;
  }
  if (m.dailyActiveUsers !== null) {
    notes.push(`daily active users=${m.dailyActiveUsers}`);
    if (m.dailyActiveUsers < 50) risk += 5;
  }
  const riskScore = Math.max(0, Math.min(100, risk));
  return { riskScore, liquidityRisk: liquidityBucket(m), notes };
}

const LEVELS = ["low", "medium", "high"] as const;

function liquidityBucket(m: Metrics): Scored["liquidityRisk"] {
  const byUtilization = m.utilization === null ? 0 : m.utilization >= 0.9 ? 2 : m.utilization >= 0.75 ? 1 : 0;
  const byTvl = m.tvlUsd < 1e7 ? 2 : m.tvlUsd < 1e8 ? 1 : 0;
  return LEVELS[Math.max(byUtilization, byTvl)]!;
}
