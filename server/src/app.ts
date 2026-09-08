import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config";
import { directory, resolveService } from "./ens";
import { registerReceiptHooks } from "./market/receipts";
import { market } from "./market/routes";

registerReceiptHooks();

export const app = new Hono();

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

app.get("/health", (c) => c.json({ ok: true }));
app.route("/s", market);

app.get("/directory", async (c) => {
  try {
    return c.json({ capability: c.req.query("capability") ?? null, names: await directory(c.req.query("capability")) });
  } catch (err) {
    return c.json({ error: message(err) }, 503);
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
