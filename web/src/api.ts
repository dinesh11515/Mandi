import { sha256, toBytes, type Hex } from "viem";
import type { Decision, Policy, ServiceCard } from "../../server/src/types";

const configuredApi = import.meta.env.VITE_API_URL as string | undefined;

export const API = configuredApi === undefined ? "/api" : configuredApi;

export const sellerHref = (name?: string) => (name ? `/seller?name=${encodeURIComponent(name)}` : "/seller");

export type Reliability = {
  supplier: string;
  calls: number;
  fulfilled: number;
  failed: number;
  successRate: number | null;
  sampleSize: number;
  avgCostHbar: number | null;
  avgLatencyMs: number | null;
  lastActive: number | null;
  source?: { topicId: string | null; hashscan: string | null };
};

export type Attestation = { valid: boolean; expiry: number; reason?: string } | null;

export type SupplierRow = { name: string; card: ServiceCard; reliability: Reliability; attestation: Attestation };

export type Activation = {
  policyHash: string;
  signer: string;
  expiry: number;
  anchored: boolean;
  hashscan: string | null;
  anchorError: string | null;
  ledger: { spentHbar: number; calls: number };
  policy: Policy;
};

export type Executor = { accountId: string; evmAddress: string; balanceHbar: number; hashscan: string };

export type Deposit = { txId: string; hashscan: string; amountHbar: number; consensusTimestamp: string | number };

export type Funding = {
  signer: string;
  account: string | null;
  depositedHbar: number;
  spentHbar: number;
  availableHbar: number;
  deposits: Deposit[];
};

export type AgentEvent = { stage: string; ts: number } & Record<string, unknown>;

export type Ranking = { rank: number; name: string; price: string; attested: boolean; successRate: number | null; sampleSize: number };

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${res.status} ${res.statusText}`.trim());
  }
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status}`);
  return body as T;
}

async function optional<T>(res: Response): Promise<T | null> {
  if (res.status === 404 || res.status === 501 || res.status === 503) return null;
  return json<T>(res);
}

export async function loadSuppliers(): Promise<SupplierRow[]> {
  const { names } = await json<{ names: string[] }>(await fetch(`${API}/directory`));
  return Promise.all(
    names.map(async (name) => {
      const [card, reliability, attestation] = await Promise.all([
        json<ServiceCard>(await fetch(`${API}/resolve/${name}`)),
        json<Reliability>(await fetch(`${API}/reliability/${name}`)),
        fetch(`${API}/attestation/${name}`).then((r) => (r.ok ? (r.json() as Promise<Attestation>) : null)).catch(() => null),
      ]);
      return { name, card, reliability, attestation };
    }),
  );
}

const HBAR_AMOUNT = /^\d+(\.\d+)? HBAR$/;

export function parsePolicy(text: string): Policy {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new Error(`the policy is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("the policy must be a JSON object");
  const fields = value as Record<string, unknown>;
  const known = ["budgetTotal", "maxPerCall", "requireVerifiedFor", "minSuccessRate", "fallbackOnFailure"];
  const extra = Object.keys(fields).filter((key) => !known.includes(key));
  if (extra.length > 0) throw new Error(`the policy has ${extra.length > 1 ? "fields" : "a field"} the executor does not know: ${extra.join(", ")}`);
  for (const key of ["budgetTotal", "maxPerCall"] as const) {
    const amount = fields[key];
    if (typeof amount !== "string" || !HBAR_AMOUNT.test(amount)) throw new Error(`${key} has to be an amount like "0.05 HBAR"`);
  }
  if (!Array.isArray(fields.requireVerifiedFor) || fields.requireVerifiedFor.some((entry) => typeof entry !== "string"))
    throw new Error("requireVerifiedFor has to be a list of capability strings, for example [\"financial\"]");
  if (typeof fields.minSuccessRate !== "number" || fields.minSuccessRate < 0 || fields.minSuccessRate > 1)
    throw new Error("minSuccessRate has to be a number between 0 and 1");
  if (typeof fields.fallbackOnFailure !== "boolean") throw new Error("fallbackOnFailure has to be true or false");
  return value as Policy;
}

export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const policyHash = (policy: Policy): string => sha256(toBytes(canonicalize(policy))).slice(2);

export const mandateMessage = (hash: string, expiry: number) => `Mandi policy ${hash} valid until ${expiry}`;

export const MANDATE_WINDOW_SECONDS = 24 * 60 * 60;

export type Mandate = { policy: Policy; policyHash: string; expiry: number; message: string };

export function mandate(policy: Policy): Mandate {
  const hash = policyHash(policy);
  const expiry = Math.floor(Date.now() / 1000) + MANDATE_WINDOW_SECONDS;
  return { policy, policyHash: hash, expiry, message: mandateMessage(hash, expiry) };
}

export async function activate(body: { policy: Policy; expiry: number; signature: Hex; signer: string }): Promise<Activation> {
  return json<Activation>(
    await fetch(`${API}/policy/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function loadActivation(hash: string): Promise<Activation> {
  return json<Activation>(await fetch(`${API}/policy/${hash}`));
}

export async function loadExecutor(): Promise<Executor | null> {
  return optional<Executor>(await fetch(`${API}/executor`));
}

export async function loadFunding(signer: string): Promise<Funding | null> {
  return optional<Funding>(await fetch(`${API}/funding/${signer}`));
}

export const STAGES = ["discovery", "resolution", "preference", "authorization", "payment", "receipt", "done"] as const;

export function stream(task: string, policyHash: string, onEvent: (ev: AgentEvent) => void, onEnd: (error: string | null) => void): () => void {
  const url = `${API}/run?task=${encodeURIComponent(task)}&policyHash=${encodeURIComponent(policyHash)}`;
  const es = new EventSource(url);
  let closed = false;
  const finish = (error: string | null) => {
    if (closed) return;
    closed = true;
    es.close();
    onEnd(error);
  };
  for (const stage of STAGES) {
    es.addEventListener(stage, (e) => {
      onEvent(JSON.parse((e as MessageEvent).data) as AgentEvent);
      if (stage === "done") finish(null);
    });
  }
  es.onerror = () => finish("lost the agent stream before it finished; the executor may be offline or the policy no longer active");
  return () => {
    closed = true;
    es.close();
  };
}

export const ensExplorer = (name: string) => `https://explorer.ens.dev/name/${name}`;
export const sepoliaTx = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;
export const hashscanTx = (id: string) => `https://hashscan.io/testnet/transaction/${id.replace("@", "-").replace(/\.(\d+)$/, "-$1")}`;
export const hashscanAccount = (id: string) => `https://hashscan.io/testnet/account/${id}`;

export type { Decision, Policy };
