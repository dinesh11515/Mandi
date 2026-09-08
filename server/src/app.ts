import { serve } from "@hono/node-server";
import { Hono } from "hono";

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, () => {
  console.log(`mandi server listening on http://localhost:${port}`);
});
