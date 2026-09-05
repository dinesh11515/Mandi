import { z } from "zod";

/** On-wire HBAR amount, e.g. `"0.05 HBAR"`. */
export const HbarAmountSchema = z
  .string()
  .regex(/^\d+(\.\d+)? HBAR$/, "expected '<n> HBAR'");

export type HbarAmount = z.infer<typeof HbarAmountSchema>;
