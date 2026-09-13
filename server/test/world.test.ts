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

const seller = privateKeyToAccount(generatePrivateKey());
process.env.SELLER_EVM_ADDRESS = seller.address;

const { attestationLookup, attestationMessage, getAttestation, issueAttestation, signedWorldRequest, verifyAndAttest, verifyAttestation, worldConfig } =
  await import("../src/world");
const { selfieCheckMessage } = await import("../src/sellers");

const wallet = seller.address;
const strangerAccount = privateKeyToAccount(generatePrivateKey());
const stranger = strangerAccount.address;

const selfieCheck = (label: string, account: typeof seller, owner = account.address) =>
  account.signMessage({ message: selfieCheckMessage({ label, owner }) });

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
    environment: "production",
    responses: [{ identifier: "selfie", signal_hash: hashSignal(signal), proof: "0x00", merkle_root: "0x01", nullifier }],
  });

  it("issues an attestation when World confirms the proof and the signal matches the wallet", async () => {
    const result = await verifyAndAttest(
      { label: "risk-pro-2", wallet, signature: await selfieCheck("risk-pro-2", seller), idkitResponse: proof(wallet, "0xnull-1") },
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
        { label: "risk-basic", wallet, signature: await selfieCheck("risk-basic", seller), idkitResponse: proof("0x0000000000000000000000000000000000000001", "0xnull-2") },
        { fetch: fakeFetch({ success: true, nullifier: "0xnull-2" }) },
      ),
    ).rejects.toThrow("signal does not match");
  });

  it("rejects a non-selfie credential", async () => {
    const orb = {
      ...proof(wallet, "0xnull-orb"),
      responses: [{ identifier: "orb", signal_hash: hashSignal(wallet), proof: "0x00", merkle_root: "0x01", nullifier: "0xnull-orb" }],
    };
    const signature = await selfieCheck("risk-basic", seller);
    await expect(verifyAndAttest({ label: "risk-basic", wallet, signature, idkitResponse: orb }, { fetch: fakeFetch({ success: true, nullifier: "0xnull-orb" }) })).rejects.toThrow(
      "expected a selfie credential",
    );
  });

  it("rejects a wallet that does not own the name, without calling World", async () => {
    const exploding = (() => {
      throw new Error("World must not be called");
    }) as unknown as typeof fetch;
    await expect(
      verifyAndAttest(
        { label: "risk-basic", wallet: stranger, signature: await selfieCheck("risk-basic", strangerAccount), idkitResponse: proof(stranger, "0xnull-4") },
        { fetch: exploding },
      ),
    ).rejects.toThrow(`${stranger} does not own risk-basic.mandi.eth`);
    await expect(
      signedWorldRequest({ label: "risk-basic", wallet: stranger, signature: await selfieCheck("risk-basic", strangerAccount) }),
    ).rejects.toThrow("does not own");
  });

  it("rejects a Selfie Check signature that does not recover the owner wallet, without calling World", async () => {
    const exploding = (() => {
      throw new Error("World must not be called");
    }) as unknown as typeof fetch;
    const forged = await selfieCheck("risk-basic", strangerAccount, wallet);
    await expect(
      verifyAndAttest({ label: "risk-basic", wallet, signature: forged, idkitResponse: proof(wallet, "0xnull-5") }, { fetch: exploding }),
    ).rejects.toThrow(`signature does not recover ${wallet}`);
    await expect(signedWorldRequest({ label: "risk-basic", wallet, signature: forged })).rejects.toThrow(`signature does not recover ${wallet}`);
  });

  it("rejects a Selfie Check signature taken over another name", async () => {
    await expect(
      signedWorldRequest({ label: "risk-basic", wallet, signature: await selfieCheck("risk-pro", seller) }),
    ).rejects.toThrow("signature does not recover");
  });

  it("advertises the parent name and explorer without a wallet", () => {
    const cfg = worldConfig();
    expect(cfg.parent).toBe("mandi.eth");
    expect(cfg.explorer).toContain("explorer.ens.dev");
    expect(cfg.labels).toContain("risk-basic");
    expect("wallet" in cfg).toBe(false);
  });

  it("rejects a World failure and a nullifier already bound to another name", async () => {
    await expect(
      verifyAndAttest(
        { label: "risk-basic", wallet, signature: await selfieCheck("risk-basic", seller), idkitResponse: proof(wallet, "0xnull-3") },
        { fetch: fakeFetch({ success: false, code: "all_verifications_failed" }, false) },
      ),
    ).rejects.toThrow("World verify failed: all_verifications_failed");
    await expect(
      verifyAndAttest(
        { label: "risk-basic", wallet, signature: await selfieCheck("risk-basic", seller), idkitResponse: proof(wallet, "0xnull-1") },
        { fetch: fakeFetch({ success: true, nullifier: "0xnull-1" }) },
      ),
    ).rejects.toThrow("already accredits risk-pro-2.mandi.eth");
  });
});
