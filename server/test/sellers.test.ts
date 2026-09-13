import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

process.env.SELLER_ACCOUNT_ID = "0.0.1234";
process.env.SELLER_EVM_ADDRESS = "";
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mandi-sellers-reg-"));
process.env.SELLERS_FILE = path.join(workdir, "sellers.json");
process.env.ATTESTATION_FILE = path.join(workdir, "attestations.json");

const { upsertSupplier } = await import("../src/config");
const { registerSeller, sellerRegistrationMessage, verifySellerRegistration } = await import("../src/sellers");

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
