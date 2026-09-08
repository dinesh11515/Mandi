import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import { config } from "./config";
import { executeIntent } from "./buyer/executor";
import { activatePolicy, describeActivation, getActivePolicy } from "./buyer/policy";
import { directory, resolveService } from "./ens";
import { registerReceiptHooks } from "./market/receipts";
import { market } from "./market/routes";
import { PurchaseIntentSchema } from "./types";

registerReceiptHooks();

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
