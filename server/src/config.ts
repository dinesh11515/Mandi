import fs from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";

if (!process.env.VITEST) {
  try {
    loadEnvFile(path.resolve(import.meta.dirname, "../../.env"));
  } catch {}
}

const env = (name: string): string => process.env[name] ?? "";

export function requireEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

const port = Number(env("PORT") || 3000);

export type Depth = "basic" | "pro";

export type Supplier = {
  label: string;
  capability: string;
  depth: Depth;
  priceHbar: number;
  deepPriceHbar: number;
  payTo: string;
  context: string;
};

const sellerAccount = () => env("SELLER_ACCOUNT_ID");

export const SUPPLIERS: Supplier[] = [
  {
    label: "risk-basic",
    capability: "financial-risk",
    depth: "basic",
    priceHbar: 0.02,
    deepPriceHbar: 0.04,
    payTo: env("PAYTO_RISK_BASIC") || sellerAccount(),
    context: "Protocol risk assessment from one on-chain metric. Unverified operator.",
  },
  {
    label: "risk-pro",
    capability: "financial-risk",
    depth: "pro",
    priceHbar: 0.05,
    deepPriceHbar: 0.1,
    payTo: env("PAYTO_RISK_PRO") || sellerAccount(),
    context: "Protocol risk assessment from TVL, utilization and liquidity. Human-verified operator.",
  },
  {
    label: "risk-pro-2",
    capability: "financial-risk",
    depth: "pro",
    priceHbar: 0.04,
    deepPriceHbar: 0.08,
    payTo: env("PAYTO_RISK_PRO_2") || sellerAccount(),
    context: "Protocol risk assessment from TVL, utilization and liquidity. Human-verified operator.",
  },
];

const extrasFile = () =>
  process.env.SELLERS_FILE || (process.env.ATTESTATION_FILE ? path.join(path.dirname(process.env.ATTESTATION_FILE), "sellers.json") : path.resolve(import.meta.dirname, "../data/sellers.json"));

function loadExtras(): Supplier[] {
  try {
    return JSON.parse(fs.readFileSync(extrasFile(), "utf8")) as Supplier[];
  } catch {
    return [];
  }
}

export function assertSellerLabel(label: string): string {
  const normalized = label.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?$/.test(normalized)) {
    throw new Error("label must be 1–16 chars, lowercase letters, digits, and hyphens");
  }
  return normalized;
}

export function allSuppliers(): Supplier[] {
  const extras = loadExtras();
  const seen = new Set(SUPPLIERS.map((s) => s.label));
  return [...SUPPLIERS, ...extras.filter((s) => !seen.has(s.label))];
}

export function supplierByLabel(label: string): Supplier | undefined {
  return allSuppliers().find((s) => s.label === label);
}

export function upsertSupplier(row: Supplier): Supplier {
  const label = assertSellerLabel(row.label);
  if (SUPPLIERS.some((s) => s.label === label)) return SUPPLIERS.find((s) => s.label === label)!;
  const next = { ...row, label, payTo: row.payTo || sellerAccount() };
  if (!next.payTo) throw new Error("missing env SELLER_ACCOUNT_ID");
  const extras = loadExtras().filter((s) => s.label !== label);
  extras.push(next);
  fs.mkdirSync(path.dirname(extrasFile()), { recursive: true });
  fs.writeFileSync(extrasFile(), JSON.stringify(extras, null, 2));
  return next;
}

function parseFailModes(spec: string): Record<string, string> {
  const modes: Record<string, string> = {};
  for (const entry of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [label, mode] = entry.split(":");
    if (label && mode) modes[label] = mode;
  }
  return modes;
}

export const config = {
  port,
  publicUrl: env("PUBLIC_URL") || `http://localhost:${port}`,
  hedera: {
    network: env("HEDERA_NETWORK") || "testnet",
    mirrorUrl: env("HEDERA_MIRROR_URL") || "https://testnet.mirrornode.hedera.com",
    topicId: env("HCS_TOPIC_ID"),
  },
  x402: {
    network: "hedera:testnet" as const,
    facilitatorUrl: env("X402_FACILITATOR_URL") || "https://api.testnet.blocky402.com",
  },
  ens: {
    rpcUrl: env("SEPOLIA_RPC_URL"),
    parentLabel: env("ENS_PARENT_LABEL") || "mandi",
    parentName: `${env("ENS_PARENT_LABEL") || "mandi"}.eth`,
    subregistry: env("ENS_SUBREGISTRY"),
    resolver: env("ENS_RESOLVER"),
    fromBlock: env("ENS_FROM_BLOCK"),
    sellerAddress: env("SELLER_EVM_ADDRESS"),
  },
  graphApiKey: env("GRAPH_API_KEY"),
  webDist: env("WEB_DIST"),
  failModes: parseFailModes(env("MANDI_FAIL")),
  upstreamTimeoutMs: Number(env("UPSTREAM_TIMEOUT_MS") || 8000),
};
