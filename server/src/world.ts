import fs from "node:fs";
import path from "node:path";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { recoverMessageAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { namehash } from "viem/ens";
import { canonicalize, sha256 } from "./buyer/policy";
import { config, requireEnv, supplierByLabel } from "./config";
import { deployerAccount, RECORD_KEYS, serviceName, setTextRecord } from "./ens";

export const WORLD_ACTION = process.env.WORLD_ACTION || "mandi-supplier-accreditation";
export const ATTESTATION_TTL_SECONDS = 90 * 24 * 60 * 60;

export type RpContext = { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };

export function rpContext(): RpContext {
  const signed = signRequest({ signingKeyHex: requireEnv("WORLD_SIGNING_KEY"), action: WORLD_ACTION, ttl: 300 });
  return {
    rp_id: requireEnv("WORLD_RP_ID"),
    nonce: signed.nonce,
    created_at: signed.createdAt,
    expires_at: signed.expiresAt,
    signature: signed.sig,
  };
}

export function sellerWallet(): Address {
  if (config.ens.sellerAddress) return config.ens.sellerAddress as Address;
  return deployerAccount().address;
}

export function signedWorldRequest(): { rp_context: RpContext; action: string; wallet: Address } {
  return { rp_context: rpContext(), action: WORLD_ACTION, wallet: sellerWallet() };
}

export type AttestationPayload = {
  name: string;
  namehash: Hex;
  wallet: Address;
  hashedNullifier: string;
  action: string;
  issuedAt: number;
  expiry: number;
};

export type AttestationRecord = AttestationPayload & { issuer: Address; sig: Hex };

const storeFile = () => process.env.ATTESTATION_FILE || path.resolve(import.meta.dirname, "../data/attestations.json");

function load(): Record<string, AttestationRecord> {
  try {
    return JSON.parse(fs.readFileSync(storeFile(), "utf8")) as Record<string, AttestationRecord>;
  } catch {
    return {};
  }
}

function save(records: Record<string, AttestationRecord>) {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify(records, null, 2));
}

export function attestationMessage(payload: AttestationPayload): string {
  return `Mandi supplier attestation ${canonicalize(payload)}`;
}

function verifier() {
  return privateKeyToAccount(requireEnv("VERIFIER_KEY") as Hex);
}

export async function issueAttestation(input: { name: string; wallet: Address; nullifier: string }): Promise<AttestationRecord> {
  const now = Math.floor(Date.now() / 1000);
  const payload: AttestationPayload = {
    name: input.name,
    namehash: namehash(input.name),
    wallet: input.wallet,
    hashedNullifier: sha256(input.nullifier),
    action: WORLD_ACTION,
    issuedAt: now,
    expiry: now + ATTESTATION_TTL_SECONDS,
  };
  const account = verifier();
  const sig = await account.signMessage({ message: attestationMessage(payload) });
  const record: AttestationRecord = { ...payload, issuer: account.address, sig };
  const records = load();
  records[input.name] = record;
  save(records);
  return record;
}

export type AttestationStatus = { valid: boolean; expiry: number; reason?: string };

export async function verifyAttestation(record: AttestationRecord): Promise<AttestationStatus> {
  const { issuer, sig, ...payload } = record;
  let expected: Address;
  try {
    expected = verifier().address;
  } catch {
    return { valid: false, expiry: record.expiry, reason: "verifier key not configured" };
  }
  if (issuer.toLowerCase() !== expected.toLowerCase()) return { valid: false, expiry: record.expiry, reason: "issued by an unknown verifier" };
  const recovered = await recoverMessageAddress({ message: attestationMessage(payload), signature: sig }).catch(() => null);
  if (!recovered || recovered.toLowerCase() !== issuer.toLowerCase()) return { valid: false, expiry: record.expiry, reason: "attestation signature invalid" };
  if (record.expiry <= Math.floor(Date.now() / 1000)) return { valid: false, expiry: record.expiry, reason: "attestation expired" };
  return { valid: true, expiry: record.expiry };
}

export function getAttestation(name: string): AttestationRecord | undefined {
  return load()[name];
}

export async function attestationLookup(name: string): Promise<AttestationStatus | null> {
  const record = getAttestation(name);
  return record ? verifyAttestation(record) : null;
}

type VerifyResponse = { success?: boolean; action?: string; nullifier?: string; code?: string; detail?: string; message?: string };

type IdkitResponse = { responses?: { identifier?: string; signal_hash?: string; nullifier?: string }[] };

export type VerifyDeps = { fetch: typeof fetch };

export async function verifyAndAttest(
  input: { label: string; wallet: Address; idkitResponse: unknown },
  deps: VerifyDeps = { fetch },
): Promise<{ attestation: AttestationRecord; ensTx: string | null; ensError: string | null }> {
  if (!supplierByLabel(input.label)) throw new Error(`unknown supplier ${input.label}`);
  const name = serviceName(input.label);
  const rpId = requireEnv("WORLD_RP_ID");
  const res = await deps.fetch(`https://developer.world.org/api/v4/verify/${rpId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.idkitResponse),
  });
  const data = (await res.json().catch(() => ({}))) as VerifyResponse;
  if (!res.ok || data.success !== true) throw new Error(`World verify failed: ${data.code ?? res.status}${data.detail ? ` ${data.detail}` : ""}`);
  if (data.action && data.action !== WORLD_ACTION) throw new Error(`proof is for action ${data.action}, expected ${WORLD_ACTION}`);
  const item = (input.idkitResponse as IdkitResponse).responses?.[0];
  const nullifier = data.nullifier ?? item?.nullifier;
  if (!nullifier) throw new Error("verify response carries no nullifier");
  if (item?.identifier && item.identifier !== "selfie" && item.identifier !== "face") {
    throw new Error(`expected a selfie credential, got ${item.identifier}`);
  }
  if (!item?.signal_hash || item.signal_hash.toLowerCase() !== hashSignal(input.wallet).toLowerCase()) {
    throw new Error("proof signal does not match the seller wallet");
  }
  const hashed = sha256(nullifier);
  const clash = Object.values(load()).find((r) => r.hashedNullifier === hashed && r.name !== name);
  if (clash) throw new Error(`this human already accredits ${clash.name}; one accreditation per human`);
  const attestation = await issueAttestation({ name, wallet: input.wallet, nullifier });
  let ensTx: string | null = null;
  let ensError: string | null = null;
  try {
    ensTx = await setTextRecord(name, RECORD_KEYS.verified, "true");
  } catch (err) {
    ensError = err instanceof Error ? err.message : String(err);
  }
  return { attestation, ensTx, ensError };
}

export function worldConfigured(): boolean {
  return Boolean(process.env.WORLD_RP_ID && process.env.WORLD_SIGNING_KEY && process.env.VERIFIER_KEY && config.publicUrl);
}
