import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
  runToken: string;
  expiry: number;
  activatedAt: number;
  hcsTx: string | null;
  anchorError: string | null;
  ledger: Ledger;
};

const active = new Map<string, ActivePolicy>();
const usedSignatures = new Set<string>();

export const MANDATE_TTL = 24 * 60 * 60;
const MANDATE_STALE_BY = 900;
const MANDATE_AHEAD_BY = 120;

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
  const { signature, signer } = input;
  if (!signature || !signer) throw new Error("sign the mandate with a wallet");
  const now = Math.floor(Date.now() / 1000);
  const expiry = input.expiry ?? now + MANDATE_TTL;
  if (expiry < now + MANDATE_TTL - MANDATE_STALE_BY) throw new Error("policy mandate is stale: sign one that expires 24 hours from now");
  if (expiry > now + MANDATE_TTL + MANDATE_AHEAD_BY) throw new Error("policy mandate reaches too far ahead: sign one that expires 24 hours from now");
  const used = signature.toLowerCase();
  if (usedSignatures.has(used)) throw new Error("mandate already used");
  const recovered = await recoverMessageAddress({ message: mandateMessage(hash, expiry), signature });
  if (recovered.toLowerCase() !== signer.toLowerCase()) throw new Error("policy mandate signature does not match signer");
  usedSignatures.add(used);
  const current = getActivePolicy(hash);
  if (current) {
    if (current.signer.toLowerCase() !== signer.toLowerCase()) throw new Error("that policy is already active for a different signer");
    return current;
  }
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
    runToken: randomBytes(32).toString("hex"),
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

export function runTokenMatches(entry: ActivePolicy, token: unknown): boolean {
  if (typeof token !== "string" || token.length !== entry.runToken.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(entry.runToken));
}

export function forgetPolicies(): void {
  active.clear();
  usedSignatures.clear();
}

export function describeActivation(entry: ActivePolicy) {
  return {
    policyHash: entry.policyHash,
    signer: entry.signer,
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
