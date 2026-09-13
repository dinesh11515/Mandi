import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.SELLER_ACCOUNT_ID = "0.0.1234";
process.env.SELLERS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mandi-sellers-")), "sellers.json");

const { allSuppliers, assertSellerLabel, removeSupplier, supplierByLabel, upsertSupplier } = await import("../src/config");
const { canonicalIdOf, labelIdOf, registerService, registryAbi, serviceRecords } = await import("../src/ens");

describe("seller listings", () => {
  it("rejects a bad label before touching chain", async () => {
    expect(() => assertSellerLabel("bad_label")).toThrow("lowercase");
    await expect(registerService("bad_label")).rejects.toThrow("lowercase");
  });

  it("refuses to mint a label no supplier row claims", async () => {
    await expect(registerService("ghost-risk")).rejects.toThrow("unknown supplier ghost-risk");
  });

  it("upserts a new seller so the x402 handler can find it", () => {
    const row = upsertSupplier({
      label: "acme-risk",
      capability: "financial-risk",
      depth: "pro",
      priceHbar: 0.03,
      deepPriceHbar: 0.06,
      payTo: "",
      context: "new",
    });
    expect(row.payTo).toBe("0.0.1234");
    expect(supplierByLabel("acme-risk")?.priceHbar).toBe(0.03);
    expect(allSuppliers().map((s) => s.label)).toContain("acme-risk");
  });

  it("refuses to store a row the suppliers table cannot price", () => {
    expect(() =>
      upsertSupplier({ label: "free-risk", capability: "financial-risk", depth: "pro", priceHbar: 0, deepPriceHbar: 0, payTo: "", context: "" }),
    ).toThrow();
    expect(supplierByLabel("free-risk")).toBeUndefined();
  });

  it("writes mandi:upstream only for a seller that published one", () => {
    upsertSupplier({
      label: "quiet-risk",
      capability: "financial-risk",
      depth: "basic",
      priceHbar: 0.01,
      deepPriceHbar: 0.02,
      payTo: "0.0.7",
      context: "no upstream",
    });
    expect(serviceRecords("quiet-risk")["mandi:upstream"]).toBeUndefined();
    upsertSupplier({
      label: "loud-risk",
      capability: "financial-risk",
      depth: "basic",
      priceHbar: 0.01,
      deepPriceHbar: 0.02,
      payTo: "0.0.7",
      context: "has upstream",
      upstream: "https://loud.example/assess",
    });
    expect(serviceRecords("loud-risk")["mandi:upstream"]).toBe("https://loud.example/assess");
  });

  it("removes only rows the sellers file owns", () => {
    expect(removeSupplier("quiet-risk")).toBe(true);
    expect(supplierByLabel("quiet-risk")).toBeUndefined();
    expect(removeSupplier("quiet-risk")).toBe(false);
    expect(removeSupplier("risk-basic")).toBe(false);
    expect(allSuppliers().map((s) => s.label)).toContain("risk-basic");
  });

  it("exposes an ownerOf reader and the version-masked token id", () => {
    expect(registryAbi.some((item) => "name" in item && item.name === "ownerOf")).toBe(true);
    expect(canonicalIdOf("acme-risk")).toBe((labelIdOf("acme-risk") >> 32n) << 32n);
    expect(canonicalIdOf("acme-risk") % (1n << 32n)).toBe(0n);
  });

  it("skips a malformed row in the sellers file instead of serving it", () => {
    const file = process.env.SELLERS_FILE!;
    const rows = JSON.parse(fs.readFileSync(file, "utf8")) as unknown[];
    fs.writeFileSync(file, JSON.stringify([...rows, { label: "broken-row" }]));
    expect(allSuppliers().map((s) => s.label)).not.toContain("broken-row");
    expect(supplierByLabel("acme-risk")?.priceHbar).toBe(0.03);
  });
});
