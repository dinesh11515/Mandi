import { z } from "zod";
import { HbarAmountSchema } from "./hbar.js";

/**
 * Resolved ENS identity. Static records only — reliability never lives here.
 * `verified` is the `mandi:verified` display hint; the executor ignores it.
 */
export const ServiceCardSchema = z.object({
  name: z.string().min(1),
  endpoint: z.string().min(1),
  agentContext: z.string(),
  capability: z.string().min(1),
  price: HbarAmountSchema,
  chain: z.string().min(1),
  verified: z.boolean().default(false),
});

export type ServiceCard = z.infer<typeof ServiceCardSchema>;
