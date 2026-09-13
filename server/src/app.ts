import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { config } from "./config";
import { run, type AgentEvent } from "./buyer/agent";
import { executeIntent, lookups } from "./buyer/executor";
import { activatePolicy, describeActivation, getActivePolicy, runTokenMatches } from "./buyer/policy";
import { buyer } from "./buyer/routes";
import { directory, directorySource, labelOf, resolveService, scanProgress } from "./ens";
import { registerReceiptHooks } from "./market/receipts";
import { reliabilityFor, reliabilityIndex, reliabilitySource } from "./market/reliability";
import { market } from "./market/routes";
import { registerSeller, RegistrationRateLimit, sellersByOwner, sellersList } from "./sellers";
import { ActivationRequestSchema, EvmAddressSchema, PurchaseIntentSchema, SellerRegistrationSchema, WorldRpRequestSchema, WorldVerificationSchema } from "./types";
import { attestationLookup, getAttestation, signedWorldRequest, verifyAndAttest, verifyAttestation, worldConfig } from "./world";

registerReceiptHooks();
lookups.reliability = (name) => reliabilityFor(labelOf(name));
lookups.attestation = attestationLookup;

export const app = new Hono();

app.use("*", cors());

const message = (err: unknown) =>
  err instanceof z.ZodError ? z.prettifyError(err) : err instanceof Error ? err.message : String(err);

app.get("/health", (c) => c.json({ ok: true }));
app.route("/s", market);
app.route("/", buyer);

app.get("/directory", async (c) => {
  const capability = c.req.query("capability");
  try {
    const names = await directory(capability);
    return c.json({ capability: capability ?? null, names, source: directorySource(), scan: scanProgress() });
  } catch (err) {
    return c.json({ error: message(err) }, 503);
  }
});

app.post("/policy/activate", async (c) => {
  try {
    const { policy, expiry, signature, signer } = ActivationRequestSchema.parse(await c.req.json());
    const entry = await activatePolicy({ policy, expiry, signature, signer });
    return c.json({ ...describeActivation(entry), runToken: entry.runToken });
  } catch (err) {
    return c.json({ error: message(err) }, 400);
  }
});

app.get("/policy/:hash", (c) => {
  const entry = getActivePolicy(c.req.param("hash"));
  return entry ? c.json(describeActivation(entry)) : c.json({ error: "no active policy with that hash" }, 404);
});

const IntentRequestSchema = PurchaseIntentSchema.extend(z.object({ token: z.string().min(1).optional() }).shape);

app.post("/intent", async (c) => {
  try {
    const { token, ...intent } = IntentRequestSchema.parse(await c.req.json());
    const entry = getActivePolicy(intent.policyHash);
    if (!entry) return c.json({ error: "no active policy with that hash" }, 404);
    if (!runTokenMatches(entry, token)) return c.json({ error: "run token required" }, 403);
    return c.json(await executeIntent(intent));
  } catch (err) {
    return c.json({ error: message(err) }, 400);
  }
});

app.get("/run", (c) => {
  const task = c.req.query("task") ?? "";
  const policyHash = c.req.query("policyHash") ?? "";
  if (!task || !policyHash) return c.json({ error: "task and policyHash query params required" }, 400);
  const entry = getActivePolicy(policyHash);
  if (!entry || !runTokenMatches(entry, c.req.query("token"))) return c.json({ error: "run token required" }, 403);
  return streamSSE(c, async (stream) => {
    const send = (ev: AgentEvent) => stream.writeSSE({ event: ev.stage, data: JSON.stringify(ev) });
    try {
      for await (const ev of run(task, policyHash)) await send(ev);
    } catch (err) {
      await send({ stage: "done", ts: Date.now(), outcome: "RUN_FAILED", error: message(err) });
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
    return c.json({ source: reliabilitySource(), ...(await reliabilityFor(labelOf(c.req.param("name")))) });
  } catch (err) {
    return c.json({ error: message(err) }, 503);
  }
});

app.get("/world/config", (c) => {
  try {
    return c.json(worldConfig());
  } catch (err) {
    return c.json({ error: message(err) }, 400);
  }
});

app.get("/sellers", async (c) => {
  try {
    return c.json({ sellers: await sellersList() });
  } catch (err) {
    return c.json({ error: message(err) }, 503);
  }
});

app.get("/sellers/by-owner/:address", async (c) => {
  try {
    return c.json({ sellers: await sellersByOwner(EvmAddressSchema.parse(c.req.param("address"))) });
  } catch (err) {
    return c.json({ error: message(err) }, 400);
  }
});

app.post("/sellers/register", async (c) => {
  try {
    return c.json(await registerSeller(SellerRegistrationSchema.parse(await c.req.json())));
  } catch (err) {
    return c.json({ error: message(err) }, err instanceof RegistrationRateLimit ? 429 : 400);
  }
});

app.post("/world/rp-signature", async (c) => {
  try {
    return c.json(await signedWorldRequest(WorldRpRequestSchema.parse(await c.req.json())));
  } catch (err) {
    return c.json({ error: message(err) }, 400);
  }
});

app.post("/world/verify", async (c) => {
  try {
    const { label, wallet, signature, idkitResponse } = WorldVerificationSchema.parse(await c.req.json());
    return c.json(await verifyAndAttest({ label, wallet, signature, idkitResponse }));
  } catch (err) {
    return c.json({ error: message(err) }, 400);
  }
});

app.get("/attestation/:name", async (c) => {
  try {
    const record = getAttestation(c.req.param("name"));
    if (!record) return c.json({ valid: false, expiry: 0, reason: "no verifier attestation on file", attestation: null });
    return c.json({ ...(await verifyAttestation(record)), attestation: record });
  } catch (err) {
    return c.json({ error: message(err) }, 500);
  }
});

app.get("/resolve/:name", async (c) => {
  try {
    return c.json(await resolveService(c.req.param("name")));
  } catch (err) {
    return c.json({ error: message(err) }, 404);
  }
});

if (config.webDist) {
  app.use("/*", serveStatic({ root: config.webDist }));
  app.get("*", serveStatic({ path: `${config.webDist}/index.html` }));
}

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`mandi server listening on ${config.publicUrl}`);
});
