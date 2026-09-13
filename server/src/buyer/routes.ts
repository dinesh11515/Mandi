import { Hono } from "hono";
import { z } from "zod";
import { lookups } from "./executor";
import { executorAccount, fundingFor } from "./funding";

const SignerSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "signer must be a 0x EVM address");

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

lookups.funding = async (signer) => {
  try {
    const { depositedHbar, spentHbar, availableHbar } = await fundingFor(signer);
    return { depositedHbar, spentHbar, availableHbar };
  } catch (err) {
    console.error(`funding lookup failed for ${signer}: ${message(err)}`);
    return null;
  }
};

export const buyer = new Hono();

buyer.get("/executor", async (c) => {
  try {
    return c.json(await executorAccount());
  } catch (err) {
    return c.json({ error: message(err) }, 503);
  }
});

buyer.get("/funding/:signer", async (c) => {
  const parsed = SignerSchema.safeParse(c.req.param("signer"));
  if (!parsed.success) return c.json({ error: "signer must be a 0x EVM address" }, 400);
  try {
    return c.json(await fundingFor(parsed.data));
  } catch (err) {
    return c.json({ error: message(err) }, 503);
  }
});
