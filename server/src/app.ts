import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { config } from "./config";
import { run } from "./buyer/agent";
import { executeIntent, lookups } from "./buyer/executor";
import { activatePolicy, describeActivation, getActivePolicy } from "./buyer/policy";
import { directory, labelOf, resolveService } from "./ens";
import { registerReceiptHooks } from "./market/receipts";
import { reliabilityFor, reliabilityIndex, reliabilitySource } from "./market/reliability";
import { market } from "./market/routes";
import { PurchaseIntentSchema } from "./types";
import { attestationLookup, getAttestation, rpContext, verifyAndAttest, verifyAttestation } from "./world";

registerReceiptHooks();
lookups.reliability = (name) => reliabilityFor(labelOf(name));
lookups.attestation = attestationLookup;

export const app = new Hono();

const message = (err: unknown) =>
  err instanceof z.ZodError ? z.prettifyError(err) : err instanceof Error ? err.message : String(err);

app.get("/health", (c) => c.json({ ok: true }));
app.route("/s", market);

app.get("/directory", async (c) => {
  try {
    return c.json({ capability: c.req.query("capability") ?? null, names: await directory(c.req.query("capability")) });
  } catch (err) {
    return c.json({ error: message(err) }, 503);
  }
});

app.post("/policy/activate", async (c) => {
  try {
    const body = await c.req.json();
    return c.json(describeActivation(await activatePolicy(body)));
  } catch (err) {
    return c.json({ error: message(err) }, 400);
  }
});

app.get("/policy/:hash", (c) => {
  const entry = getActivePolicy(c.req.param("hash"));
  return entry ? c.json(describeActivation(entry)) : c.json({ error: "no active policy with that hash" }, 404);
});

app.post("/intent", async (c) => {
  try {
    const intent = PurchaseIntentSchema.parse(await c.req.json());
    return c.json(await executeIntent(intent));
  } catch (err) {
    return c.json({ error: message(err) }, 400);
  }
});

app.get("/run", (c) => {
  const task = c.req.query("task") ?? "";
  const policyHash = c.req.query("policyHash") ?? "";
  if (!task || !policyHash) return c.json({ error: "task and policyHash query params required" }, 400);
  return streamSSE(c, async (stream) => {
    for await (const ev of run(task, policyHash)) {
      await stream.writeSSE({ event: ev.stage, data: JSON.stringify(ev) });
    }
  });
});

app.get("/reliability", async (c) => {
  try {
    return c.json({ source: reliabilitySource(), suppliers: [...(await reliabilityIndex()).values()] });
  } catch (err) {
    return c.json({ error: message(err) }, 503);
  }
});

app.get("/reliability/:name", async (c) => {
  try {
    return c.json({ source: reliabilitySource(), ...(await reliabilityFor(c.req.param("name").split(".")[0]!)) });
  } catch (err) {
    return c.json({ error: message(err) }, 503);
  }
});

app.post("/world/rp-signature", (c) => {
  try {
    return c.json(rpContext());
  } catch (err) {
    return c.json({ error: message(err) }, 400);
  }
});

app.post("/world/verify", async (c) => {
  try {
    const body = (await c.req.json()) as { label: string; wallet: `0x${string}`; idkitResponse: unknown };
    return c.json(await verifyAndAttest(body));
  } catch (err) {
    return c.json({ error: message(err) }, 400);
  }
});

app.get("/attestation/:name", async (c) => {
  const record = getAttestation(c.req.param("name"));
  if (!record) return c.json({ error: "no attestation for that name" }, 404);
  return c.json({ ...(await verifyAttestation(record)), attestation: record });
});

app.get("/resolve/:name", async (c) => {
  try {
    return c.json(await resolveService(c.req.param("name")));
  } catch (err) {
    return c.json({ error: message(err) }, 404);
  }
});

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`mandi server listening on ${config.publicUrl}`);
});
