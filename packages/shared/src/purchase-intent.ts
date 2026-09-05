import { z } from "zod";
import { PolicySchema } from "./policy.js";

/** Agent → executor. Executor re-resolves `supplier` and re-reads price; never trust a card on the intent. */
export const PurchaseIntentSchema = z.object({
  supplier: z.string().min(1),
  route: z.string().min(1),
  policy: PolicySchema,
});

export type PurchaseIntent = z.infer<typeof PurchaseIntentSchema>;
