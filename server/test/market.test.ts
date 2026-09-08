import { describe, expect, it } from "vitest";

process.env.SELLER_ACCOUNT_ID = "0.0.1234";
process.env.MANDI_FAIL = "risk-pro:error,risk-pro-2:timeout";
process.env.UPSTREAM_TIMEOUT_MS = "10";

const { handle } = await import("../src/market/routes");

describe("supplier handler", () => {
  it("serves an assessment with a latency value", async () => {
    const r = await handle("risk-basic", "aave", false);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ supplier: "risk-basic", protocol: "aave", depth: "basic" });
    expect(typeof r.latencyMs).toBe("number");
  });

  it("rejects unknown suppliers and missing protocols", async () => {
    expect((await handle("nope", "aave", false)).status).toBe(404);
    expect((await handle("risk-basic", "", false)).status).toBe(400);
  });

  it("fails after the payment was authorized when MANDI_FAIL is set", async () => {
    expect((await handle("risk-pro", "aave", false)).status).toBe(500);
    const started = Date.now();
    expect((await handle("risk-pro-2", "aave", false)).status).toBe(504);
    expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
  });
});
