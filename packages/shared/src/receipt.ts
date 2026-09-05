import { z } from "zod";
import { HbarAmountSchema } from "./hbar.js";

/** HCS payload after settlement (success or upstream failure). Hashes filled in T17. */
export const ReceiptSchema = z.object({
  supplier: z.string().min(1),
  route: z.string().min(1),
  amountHbar: HbarAmountSchema,
  txId: z.string().min(1),
  settled: z.boolean(),
  fulfilled: z.boolean(),
  latencyMs: z.number().nonnegative(),
  ts: z.number().int().nonnegative(),
  policyHash: z.string().nullable(),
  decisionHash: z.string().nullable(),
});

export type Receipt = z.infer<typeof ReceiptSchema>;
