import { z } from "zod";
import { HbarAmountSchema } from "./hbar.js";

export const PolicySchema = z
  .object({
    budgetTotal: HbarAmountSchema,
    maxPerCall: HbarAmountSchema,
    requireVerifiedFor: z.array(z.string()),
    minSuccessRate: z.number().min(0).max(1),
    fallbackOnFailure: z.boolean(),
  })
  .strict();

export type Policy = z.infer<typeof PolicySchema>;

/** §3.4 sample — human-editable fixture. */
export const SAMPLE_POLICY = {
  budgetTotal: "1 HBAR",
  maxPerCall: "0.05 HBAR",
  requireVerifiedFor: ["financial"],
  minSuccessRate: 0.95,
  fallbackOnFailure: true,
} as const satisfies Policy;
