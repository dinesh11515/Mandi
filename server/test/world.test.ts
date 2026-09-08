import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";

process.env.VERIFIER_KEY = generatePrivateKey();
process.env.WORLD_RP_ID = "rp_test";
process.env.SELLER_ACCOUNT_ID = "0.0.1234";
process.env.ATTESTATION_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mandi-")), "attestations.json");

const { attestationLookup, attestationMessage, getAttestation, issueAttestation, verifyAndAttest, verifyAttestation } = await import("../src/world");

const wallet = privateKeyToAccount(generatePrivateKey()).address;

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: ok ? 200 : 400 })) as unknown as typeof fetch;
}

describe("attestations", () => {
  beforeAll(async () => {
    await issueAttestation({ name: "risk-pro.mandi.eth", wallet, nullifier: "0xabc" });
  });

  it("verifies a record it issued", async () => {
    const status = await attestationLookup("risk-pro.mandi.eth");
    expect(status?.valid).toBe(true);
  });

  it("rejects a tampered record, a forged issuer, and an expired mandate", async () => {
    const record = getAttestation("risk-pro.mandi.eth")!;
    expect((await verifyAttestation({ ...record, wallet: privateKeyToAccount(generatePrivateKey()).address })).reason).toBe("attestation signature invalid");
    const forger = privateKeyToAccount(generatePrivateKey());
    const { issuer: _issuer, sig: _sig, ...payload } = record;
    const forgedSig = await forger.signMessage({ message: attestationMessage(payload) });
    expect((await verifyAttestation({ ...record, issuer: forger.address, sig: forgedSig })).reason).toBe("issued by an unknown verifier");
    const expired = { ...payload, expiry: 1 };
    const verifierSig = await privateKeyToAccount(process.env.VERIFIER_KEY as `0x${string}`).signMessage({ message: attestationMessage(expired) });
    expect((await verifyAttestation({ ...expired, issuer: record.issuer, sig: verifierSig })).reason).toBe("attestation expired");
  });

  it("returns null for names without an attestation", async () => {
    expect(await attestationLookup("risk-basic.mandi.eth")).toBeNull();
  });
});

describe("verifyAndAttest", () => {
  const proof = (signal: string, nullifier: string) => ({
    protocol_version: "3.0",
    nonce: "n",
    action: "mandi-supplier-accreditation",
    environment: "sandbox",
    responses: [{ identifier: "selfie", signal_hash: hashSignal(signal), proof: "0x00", merkle_root: "0x01", nullifier }],
  });

  it("issues an attestation when World confirms the proof and the signal matches the wallet", async () => {
    const result = await verifyAndAttest(
      { label: "risk-pro-2", wallet, idkitResponse: proof(wallet, "0xnull-1") },
      { fetch: fakeFetch({ success: true, action: "mandi-supplier-accreditation", nullifier: "0xnull-1" }) },
    );
    expect(result.attestation.name).toBe("risk-pro-2.mandi.eth");
    expect(result.attestation.wallet).toBe(wallet);
    expect(result.ensError).toBeTruthy();
    expect((await attestationLookup("risk-pro-2.mandi.eth"))?.valid).toBe(true);
  });

  it("rejects a proof whose signal is not the seller wallet", async () => {
    await expect(
      verifyAndAttest(
        { label: "risk-basic", wallet, idkitResponse: proof("0x0000000000000000000000000000000000000001", "0xnull-2") },
        { fetch: fakeFetch({ success: true, nullifier: "0xnull-2" }) },
      ),
    ).rejects.toThrow("signal does not match");
  });

  it("rejects a World failure and a nullifier already bound to another name", async () => {
    await expect(
      verifyAndAttest({ label: "risk-basic", wallet, idkitResponse: proof(wallet, "0xnull-3") }, { fetch: fakeFetch({ success: false, code: "all_verifications_failed" }, false) }),
    ).rejects.toThrow("World verify failed: all_verifications_failed");
    await expect(
      verifyAndAttest({ label: "risk-basic", wallet, idkitResponse: proof(wallet, "0xnull-1") }, { fetch: fakeFetch({ success: true, nullifier: "0xnull-1" }) }),
    ).rejects.toThrow("already accredits risk-pro-2.mandi.eth");
  });
});
