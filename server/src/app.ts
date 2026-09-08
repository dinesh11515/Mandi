import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config";
import { registerReceiptHooks } from "./market/receipts";
import { market } from "./market/routes";

registerReceiptHooks();

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/s", market);

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`mandi server listening on ${config.publicUrl}`);
});
