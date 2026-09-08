import { z } from "zod";

export const HbarAmountSchema = z
  .string()
  .regex(/^\d+(\.\d+)? HBAR$/, "expected '<n> HBAR'");

export type HbarAmount = z.infer<typeof HbarAmountSchema>;

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

export const SAMPLE_POLICY = {
  budgetTotal: "1 HBAR",
  maxPerCall: "0.05 HBAR",
  requireVerifiedFor: ["financial"],
  minSuccessRate: 0.95,
  fallbackOnFailure: true,
} as const satisfies Policy;

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

export const PurchaseIntentSchema = z.object({
  supplier: z.string().min(1),
  route: z.string().min(1),
  protocol: z.string().min(1),
  policyHash: z.string().length(64),
});

export type PurchaseIntent = z.infer<typeof PurchaseIntentSchema>;

export const DecisionStatusSchema = z.enum(["approved", "rejected"]);

export const CheckSchema = z.object({
  name: z.string().min(1),
  passed: z.boolean(),
  detail: z.string(),
});

export const DecisionSchema = z.object({
  status: DecisionStatusSchema,
  reasons: z.array(z.string()),
  supplier: z.string().min(1),
  route: z.string().min(1),
  policyHash: z.string().length(64),
  priceHbar: z.number().nonnegative(),
  checks: z.array(CheckSchema),
  ts: z.number().int().nonnegative(),
});

export type Check = z.infer<typeof CheckSchema>;

export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;
export type Decision = z.infer<typeof DecisionSchema>;

export const ReceiptSchema = z.object({
  supplier: z.string().min(1),
  route: z.string().min(1),
  amountHbar: HbarAmountSchema,
  txId: z.string().nullable(),
  settled: z.boolean(),
  fulfilled: z.boolean(),
  latencyMs: z.number().nonnegative(),
  ts: z.number().int().nonnegative(),
  policyHash: z.string().nullable(),
  status: z.number().int().optional(),
  error: z.string().optional(),
});

export type Receipt = z.infer<typeof ReceiptSchema>;
