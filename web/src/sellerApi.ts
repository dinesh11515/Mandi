import type { IDKitResult, RpContext } from "@worldcoin/idkit";
import { API } from "./api";

export type Tier = "basic" | "pro";

export type SellerRow = {
  label: string;
  name: string;
  owner: string;
  capability: string;
  depth: Tier;
  priceHbar: number;
  deepPriceHbar: number;
  payTo: string;
  upstream: string;
  context: string;
  listed: boolean;
  attested: boolean;
};

export type WorldConfig = { action: string; labels: string[]; parent: string; explorer: string };

export type RegisterResult = {
  name: string;
  owner: string;
  minted: boolean;
  mintTx: string | null;
  recordsTx: string;
  records: Record<string, string>;
  supplier?: SellerRow;
};

export type RegisterBody = {
  label: string;
  owner: string;
  signature: string;
  payTo: string;
  priceHbar: number;
  capability: string;
  depth: Tier;
  upstream: string;
  context: string;
};

export type RpSignature = { rp_context: RpContext; action: string; wallet: string; name: string };

export type AttestationRecord = { name: string; wallet: string; hashedNullifier: string; expiry: number; issuer: string; sig: string };

export type VerifyResult = { attestation: AttestationRecord; ensTx: string | null; ensError: string | null };

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(text.trim().slice(0, 200) || `${res.status} ${res.statusText}`.trim());
  }
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status}`);
  return body as T;
}

const post = async <T,>(path: string, body: unknown): Promise<T> =>
  json<T>(
    await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

export const loadWorldConfig = async (): Promise<WorldConfig> => json<WorldConfig>(await fetch(`${API}/world/config`));

export async function loadListings(owner: string): Promise<SellerRow[]> {
  const body = await json<{ sellers: SellerRow[] }>(await fetch(`${API}/sellers/by-owner/${owner}`));
  return body.sellers ?? [];
}

export function sellerRegistrationMessage(input: { name: string; owner: string; payTo: string; priceHbar: number; capability: string }): string {
  return [
    "Mandi seller registration",
    `name: ${input.name}`,
    `owner: ${input.owner.toLowerCase()}`,
    `payTo: ${input.payTo}`,
    `price: ${input.priceHbar} HBAR`,
    `capability: ${input.capability}`,
  ].join("\n");
}

export const registerSeller = (body: RegisterBody): Promise<RegisterResult> => post<RegisterResult>("/sellers/register", body);

export const rpSignature = (label: string, wallet: string): Promise<RpSignature> => post<RpSignature>("/world/rp-signature", { label, wallet });

export const verifySelfie = (label: string, wallet: string, idkitResponse: IDKitResult): Promise<VerifyResult> =>
  post<VerifyResult>("/world/verify", { label, wallet, idkitResponse });

export const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
