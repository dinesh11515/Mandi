import type { Decision, Policy, ServiceCard } from "../../server/src/types";

const configuredApi = import.meta.env.VITE_API_URL as string | undefined;

export const API = configuredApi === undefined ? "/api" : configuredApi;

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

export type AgentEvent = { stage: string; ts: number } & Record<string, unknown>;

export type Ranking = { rank: number; name: string; price: string; attested: boolean; successRate: number | null; sampleSize: number };

async function json<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status}`);
  return body as T;
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

export async function activate(policy: unknown): Promise<Activation> {
  return json<Activation>(
    await fetch(`${API}/policy/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policy }),
    }),
  );
}

export async function loadActivation(hash: string): Promise<Activation> {
  return json<Activation>(await fetch(`${API}/policy/${hash}`));
}

export const STAGES = ["discovery", "resolution", "preference", "authorization", "payment", "receipt", "done"] as const;

export function stream(task: string, policyHash: string, onEvent: (ev: AgentEvent) => void, onEnd: () => void): () => void {
  const url = `${API}/run?task=${encodeURIComponent(task)}&policyHash=${encodeURIComponent(policyHash)}`;
  const es = new EventSource(url);
  for (const stage of STAGES) {
    es.addEventListener(stage, (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as AgentEvent;
      onEvent(ev);
      if (stage === "done") {
        es.close();
        onEnd();
      }
    });
  }
  es.onerror = () => {
    es.close();
    onEnd();
  };
  return () => es.close();
}

export const ensExplorer = (name: string) => `https://explorer.ens.dev/name/${name}`;

export type { Decision, Policy, ServiceCard };
