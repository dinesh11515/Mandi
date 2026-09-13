import { createHash } from "node:crypto";
import { recoverMessageAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { requireEnv } from "../config";
import { hashscanTx, hcsSubmit } from "../hedera";
import { PolicySchema, type Policy } from "../types";

export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function policyHash(policy: Policy): string {
  return sha256(canonicalize(PolicySchema.parse(policy)));
}

export function mandateMessage(hash: string, expiry: number): string {
  return `Mandi policy ${hash} valid until ${expiry}`;
}

export type Ledger = { spentHbar: number; calls: number };

export type ActivePolicy = {
  policy: Policy;
  policyHash: string;
  signer: Address;
  signature: Hex;
  expiry: number;
  activatedAt: number;
  hcsTx: string | null;
  anchorError: string | null;
  ledger: Ledger;
};

const active = new Map<string, ActivePolicy>();

export async function signMandate(hash: string, expiry: number): Promise<{ signer: Address; signature: Hex }> {
  if (!process.env.HUMAN_KEY) throw new Error("sign the mandate with a wallet: HUMAN_KEY is not configured");
  const account = privateKeyToAccount(requireEnv("HUMAN_KEY") as Hex);
  const signature = await account.signMessage({ message: mandateMessage(hash, expiry) });
  return { signer: account.address, signature };
}

export type ActivationInput = {
  policy: unknown;
  expiry?: number;
  signature?: Hex;
  signer?: Address;
};

export async function activatePolicy(input: ActivationInput): Promise<ActivePolicy> {
  const policy = PolicySchema.parse(input.policy);
  const hash = policyHash(policy);
  const expiry = input.expiry ?? Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  if (expiry <= Math.floor(Date.now() / 1000)) throw new Error("policy mandate is expired");
  const { signer, signature } =
    input.signature && input.signer
      ? { signer: input.signer, signature: input.signature }
      : await signMandate(hash, expiry);
  const recovered = await recoverMessageAddress({ message: mandateMessage(hash, expiry), signature });
  if (recovered.toLowerCase() !== signer.toLowerCase()) throw new Error("policy mandate signature does not match signer");
  let hcsTx: string | null = null;
  let anchorError: string | null = null;
  try {
    hcsTx = await hcsSubmit({ type: "POLICY_ACTIVATED", policyHash: hash, expiry, signer, signature });
  } catch (err) {
    anchorError = err instanceof Error ? err.message : String(err);
  }
  const entry: ActivePolicy = {
    policy,
    policyHash: hash,
    signer,
    signature,
    expiry,
    activatedAt: Date.now(),
    hcsTx,
    anchorError,
    ledger: { spentHbar: 0, calls: 0 },
  };
  active.set(hash, entry);
  return entry;
}

export function getActivePolicy(hash: string): ActivePolicy | undefined {
  const entry = active.get(hash);
  if (!entry) return undefined;
  if (entry.expiry <= Math.floor(Date.now() / 1000)) return undefined;
  return entry;
}

export function describeActivation(entry: ActivePolicy) {
  return {
    policyHash: entry.policyHash,
    signer: entry.signer,
    signature: entry.signature,
    expiry: entry.expiry,
    activatedAt: entry.activatedAt,
    anchored: entry.hcsTx !== null,
    hcsTx: entry.hcsTx,
    hashscan: entry.hcsTx ? hashscanTx(entry.hcsTx) : null,
    anchorError: entry.anchorError,
    ledger: entry.ledger,
    policy: entry.policy,
  };
}
