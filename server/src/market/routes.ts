import { Hono } from "hono";
import { config, supplierByLabel } from "../config";
import { assess } from "./assess";
import { routeInfo, x402Gate } from "./x402";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const market = new Hono();

market.use("/:label/*", async (c, next) => {
  const label = c.req.param("label");
  if (!supplierByLabel(label)) return c.json({ error: `unknown supplier ${label}` }, 404);
  if (!routeInfo(c.req.path)) return c.json({ error: `no priced route at ${c.req.path}` }, 404);
  await next();
});

market.use("*", x402Gate);

export async function handle(label: string, protocol: string, deep: boolean) {
  const supplier = supplierByLabel(label);
  if (!supplier) return { status: 404 as const, body: { error: `unknown supplier ${label}` } };
  if (!protocol) return { status: 400 as const, body: { error: "protocol query param required" } };
  const failMode = config.failModes[label];
  if (failMode === "timeout") {
    await sleep(config.upstreamTimeoutMs + 2000);
    return { status: 504 as const, body: { error: "upstream timeout" } };
  }
  if (failMode === "error") return { status: 500 as const, body: { error: "upstream error" } };
  const started = Date.now();
  const result = await assess(protocol, supplier.depth, deep);
  return {
    status: 200 as const,
    body: { supplier: label, protocol, depth: supplier.depth, deep, ...result },
    latencyMs: Date.now() - started,
  };
}

market.get("/:label/assess", async (c) => {
  const r = await handle(c.req.param("label"), c.req.query("protocol") ?? "", false);
  if (r.latencyMs !== undefined) c.header("X-Mandi-Latency-Ms", String(r.latencyMs));
  return c.json(r.body, r.status);
});

market.get("/:label/assess/deep", async (c) => {
  const r = await handle(c.req.param("label"), c.req.query("protocol") ?? "", true);
  if (r.latencyMs !== undefined) c.header("X-Mandi-Latency-Ms", String(r.latencyMs));
  return c.json(r.body, r.status);
});
