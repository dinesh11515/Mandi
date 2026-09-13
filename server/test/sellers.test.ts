import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zeroAddress, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

process.env.SELLER_ACCOUNT_ID = "0.0.1234";
process.env.SELLER_EVM_ADDRESS = "";
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mandi-sellers-reg-"));
process.env.SELLERS_FILE = path.join(workdir, "sellers.json");
process.env.ATTESTATION_FILE = path.join(workdir, "attestations.json");

const { supplierByLabel, upsertSupplier } = await import("../src/config");
const { assertSelfieCheckOwner, recoverSelfieCheckSigner, registerSeller, sellerRegistrationMessage, selfieCheckMessage, REGISTRATION_LIMITS, RegistrationRateLimit, verifySellerRegistration } =
  await import("../src/sellers");
type Deps = Parameters<typeof registerSeller>[1];

const seller = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

const registration = {
  label: "acme-risk",
  owner: seller.address.toLowerCase(),
  payTo: "0.0.5150",
  priceHbar: 0.03,
  capability: "financial-risk",
};

describe("seller registration message", () => {
  it("is the frozen six-line format", () => {
    expect(sellerRegistrationMessage(registration)).toBe(
      [
        "Mandi seller registration",
        "name: acme-risk.mandi.eth",
        `owner: ${seller.address.toLowerCase()}`,
        "payTo: 0.0.5150",
        "price: 0.03 HBAR",
        "capability: financial-risk",
      ].join("\n"),
    );
  });

  it("lowercases the owner whatever case the wallet reports", () => {
    expect(sellerRegistrationMessage({ ...registration, owner: seller.address })).toBe(sellerRegistrationMessage(registration));
  });
});

describe("verifySellerRegistration", () => {
  it("recovers the owner from a signature over the message", async () => {
    const signature = await seller.signMessage({ message: sellerRegistrationMessage(registration) });
    expect(await verifySellerRegistration({ ...registration, signature })).toBe(true);
  });

  it("rejects a signature from another wallet", async () => {
    const signature = await stranger.signMessage({ message: sellerRegistrationMessage(registration) });
    expect(await verifySellerRegistration({ ...registration, signature })).toBe(false);
  });

  it("rejects a signature over different terms", async () => {
    const signature = await seller.signMessage({ message: sellerRegistrationMessage({ ...registration, priceHbar: 9 }) });
    expect(await verifySellerRegistration({ ...registration, signature })).toBe(false);
  });
});

describe("registerSeller", () => {
  const full = { ...registration, depth: "pro" as const, context: "new operator", upstream: "" };

  it("refuses an unsigned claim before touching chain", async () => {
    const signature = await stranger.signMessage({ message: sellerRegistrationMessage(registration) });
    await expect(registerSeller({ ...full, signature })).rejects.toThrow("signature does not recover");
  });

  it("refuses a label already owned by another wallet", async () => {
    upsertSupplier({
      label: "taken-risk",
      owner: stranger.address,
      capability: "financial-risk",
      depth: "pro",
      priceHbar: 0.02,
      deepPriceHbar: 0.04,
      payTo: "0.0.9",
      context: "first",
    });
    const claim = { ...full, label: "taken-risk" };
    const signature = await seller.signMessage({ message: sellerRegistrationMessage(claim) });
    await expect(registerSeller({ ...claim, signature })).rejects.toThrow(`belongs to ${stranger.address.toLowerCase()}`);
  });
});

describe("Selfie Check message", () => {
  it("is the frozen three-line format with a lowercase owner", () => {
    expect(selfieCheckMessage({ label: "acme-risk", owner: seller.address })).toBe(
      ["Mandi Selfie Check", "name: acme-risk.mandi.eth", `owner: ${seller.address.toLowerCase()}`].join("\n"),
    );
    expect(selfieCheckMessage({ label: "acme-risk", owner: seller.address.toLowerCase() })).toBe(
      selfieCheckMessage({ label: "acme-risk", owner: seller.address }),
    );
  });

  it("recovers the wallet that signed it and nobody else", async () => {
    const signature = await seller.signMessage({ message: selfieCheckMessage({ label: "acme-risk", owner: seller.address }) });
    expect(await recoverSelfieCheckSigner({ label: "acme-risk", wallet: seller.address, signature })).toBe(seller.address);
    expect(await recoverSelfieCheckSigner({ label: "other-risk", wallet: seller.address, signature })).not.toBe(seller.address);
    expect(await recoverSelfieCheckSigner({ label: "acme-risk", wallet: seller.address, signature: "0xdead" })).toBeNull();
  });

  it("accepts the owner of the row and rejects a signature from another wallet", async () => {
    upsertSupplier({
      label: "selfie-risk",
      owner: seller.address,
      capability: "financial-risk",
      depth: "pro",
      priceHbar: 0.02,
      deepPriceHbar: 0.04,
      payTo: "0.0.9",
      context: "selfie",
    });
    const message = selfieCheckMessage({ label: "selfie-risk", owner: seller.address });
    const signature = await seller.signMessage({ message });
    expect((await assertSelfieCheckOwner({ label: "selfie-risk", wallet: seller.address, signature })).label).toBe("selfie-risk");
    const forged = await stranger.signMessage({ message });
    await expect(assertSelfieCheckOwner({ label: "selfie-risk", wallet: seller.address, signature: forged })).rejects.toThrow(
      `signature does not recover ${seller.address}`,
    );
    await expect(assertSelfieCheckOwner({ label: "selfie-risk", wallet: stranger.address, signature: forged })).rejects.toThrow("does not own");
  });
});

const mintResult = (label: string, owner: string) => ({
  name: `${label}.mandi.eth`,
  owner: owner as Address,
  minted: true,
  mintTx: null,
  recordsTx: "0x00" as const,
  records: {},
});

const claimFor = async (label: string, account: typeof seller) => {
  const claim = { label, owner: account.address.toLowerCase(), payTo: "0.0.5150", priceHbar: 0.03, capability: "financial-risk", depth: "pro" as const, context: "new operator", upstream: "" };
  return { ...claim, signature: await account.signMessage({ message: sellerRegistrationMessage(claim) }) };
};

const unclaimed: Deps = { chainOwnership: async () => ({ resolver: zeroAddress, owner: zeroAddress }), registerService: async (label, opts) => mintResult(label, opts?.owner ?? ""), now: Date.now };

describe("on-chain ownership", () => {
  it("refuses a name another wallet already owns on chain", async () => {
    const claim = await claimFor("hijack-risk", seller);
    const deps: Deps = { ...unclaimed, chainOwnership: async () => ({ resolver: "0x00000000000000000000000000000000000000ff", owner: stranger.address }) };
    await expect(registerSeller(claim, deps)).rejects.toThrow(`hijack-risk.mandi.eth is owned on chain by ${stranger.address}`);
    expect(supplierByLabel("hijack-risk")).toBeUndefined();
  });

  it("refuses to proceed when the on-chain read fails", async () => {
    const claim = await claimFor("blind-risk", seller);
    const deps: Deps = {
      ...unclaimed,
      chainOwnership: async () => {
        throw new Error("rpc down");
      },
    };
    await expect(registerSeller(claim, deps)).rejects.toThrow("cannot read the on-chain owner of blind-risk.mandi.eth: rpc down");
    expect(supplierByLabel("blind-risk")).toBeUndefined();
  });

  it("mints a name nobody owns on chain", async () => {
    const claim = await claimFor("free-name-risk", seller);
    const result = await registerSeller(claim, unclaimed);
    expect(result.name).toBe("free-name-risk.mandi.eth");
    expect(supplierByLabel("free-name-risk")?.owner).toBe(seller.address.toLowerCase());
  });
});

describe("rollback", () => {
  const failing: Deps = {
    ...unclaimed,
    registerService: async () => {
      throw new Error("mint reverted");
    },
  };

  it("removes a row it created when the mint fails", async () => {
    const claim = await claimFor("doomed-risk", seller);
    await expect(registerSeller(claim, failing)).rejects.toThrow("mint reverted");
    expect(supplierByLabel("doomed-risk")).toBeUndefined();
  });

  it("keeps a row that already existed when a refresh fails", async () => {
    upsertSupplier({
      label: "kept-risk",
      owner: seller.address,
      capability: "financial-risk",
      depth: "pro",
      priceHbar: 0.02,
      deepPriceHbar: 0.04,
      payTo: "0.0.9",
      context: "first draft",
    });
    const claim = await claimFor("kept-risk", seller);
    await expect(registerSeller(claim, failing)).rejects.toThrow("mint reverted");
    expect(supplierByLabel("kept-risk")?.owner).toBe(seller.address.toLowerCase());
  });
});

describe("registration rate limit", () => {
  it("stops an owner at three an hour and the process at twenty", async () => {
    let now = Date.now() + 10 * REGISTRATION_LIMITS.windowMs;
    const deps: Deps = { ...unclaimed, now: () => now };
    const claim = await claimFor("greedy-risk", seller);
    for (let i = 0; i < REGISTRATION_LIMITS.perOwnerPerHour; i += 1) await registerSeller(claim, deps);
    await expect(registerSeller(claim, deps)).rejects.toThrow(RegistrationRateLimit);
    await expect(registerSeller(claim, deps)).rejects.toThrow(`used its ${REGISTRATION_LIMITS.perOwnerPerHour} registrations`);

    now += REGISTRATION_LIMITS.windowMs + 1;
    let admitted = 0;
    let refusal = "";
    for (let owner = 0; owner < 8; owner += 1) {
      const account = privateKeyToAccount(generatePrivateKey());
      const fresh = await claimFor(`rl${owner}-risk`, account);
      for (let attempt = 0; attempt < REGISTRATION_LIMITS.perOwnerPerHour; attempt += 1) {
        try {
          await registerSeller(fresh, deps);
          admitted += 1;
        } catch (err) {
          refusal = err instanceof Error ? err.message : String(err);
          break;
        }
      }
      if (refusal) break;
    }
    expect(admitted).toBe(REGISTRATION_LIMITS.perHour);
    expect(refusal).toContain(`at most ${REGISTRATION_LIMITS.perHour} registrations`);

    now += REGISTRATION_LIMITS.windowMs + 1;
    expect((await registerSeller(await claimFor("after-risk", seller), deps)).name).toBe("after-risk.mandi.eth");
  });
});
