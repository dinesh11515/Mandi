import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.SELLER_ACCOUNT_ID = "0.0.1234";
process.env.SELLERS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mandi-sellers-")), "sellers.json");

const { allSuppliers, assertSellerLabel, supplierByLabel, upsertSupplier } = await import("../src/config");
const { registerService } = await import("../src/ens");

describe("seller listings", () => {
  it("rejects a bad label before touching chain", async () => {
    expect(() => assertSellerLabel("bad_label")).toThrow("lowercase");
    await expect(registerService("bad_label")).rejects.toThrow("lowercase");
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

  it("skips a malformed row in the sellers file instead of serving it", () => {
    const file = process.env.SELLERS_FILE!;
    const rows = JSON.parse(fs.readFileSync(file, "utf8")) as unknown[];
    fs.writeFileSync(file, JSON.stringify([...rows, { label: "broken-row" }]));
    expect(allSuppliers().map((s) => s.label)).not.toContain("broken-row");
    expect(supplierByLabel("acme-risk")?.priceHbar).toBe(0.03);
  });
});
