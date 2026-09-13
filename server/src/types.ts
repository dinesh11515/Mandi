import { z } from "zod";

export const HbarAmountSchema = z
  .string()
  .regex(/^\d+(\.\d+)? HBAR$/, "expected '<n> HBAR'");

export type HbarAmount = z.infer<typeof HbarAmountSchema>;

export const EvmAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "expected an EVM address")
  .transform((value) => value as `0x${string}`);

export const HexSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/, "expected 0x-prefixed hex")
  .transform((value) => value as `0x${string}`);

export const DepthSchema = z.enum(["basic", "pro"]);

export type Depth = z.infer<typeof DepthSchema>;

export const HederaAccountSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "expected a Hedera account id like 0.0.1234");

const httpUrlOrEmpty = (value: string): boolean => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export const UpstreamSchema = z.string().refine(httpUrlOrEmpty, "expected an http(s) URL").default("");

export const SupplierSchema = z.object({
  label: z.string().min(1),
  capability: z.string().min(1),
  depth: DepthSchema,
  priceHbar: z.number().positive(),
  deepPriceHbar: z.number().positive(),
  payTo: z.string(),
  context: z.string(),
  owner: z.string().default(""),
  upstream: UpstreamSchema,
});

export type Supplier = z.infer<typeof SupplierSchema>;
export type SupplierInput = z.input<typeof SupplierSchema>;

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

export const ActivationRequestSchema = z.object({
  policy: z.unknown(),
  expiry: z.number().int().positive().optional(),
  signature: HexSchema.optional(),
  signer: EvmAddressSchema.optional(),
});

export const SellerRegistrationSchema = z.object({
  label: z.string().min(1),
  owner: EvmAddressSchema,
  signature: HexSchema,
  payTo: HederaAccountSchema,
  priceHbar: z.number().positive(),
  capability: z.string().min(1),
  depth: DepthSchema,
  upstream: UpstreamSchema,
  context: z.string(),
});

export type SellerRegistration = z.infer<typeof SellerRegistrationSchema>;

export const WorldRpRequestSchema = z.object({
  label: z.string().min(1),
  wallet: EvmAddressSchema,
  signature: HexSchema,
});

export const WorldVerificationSchema = WorldRpRequestSchema.extend({
  idkitResponse: z.unknown(),
});

export const ServiceCardSchema = z.object({
  name: z.string().min(1),
  endpoint: z.string().min(1),
  agentContext: z.string(),
  capability: z.string().min(1),
  price: HbarAmountSchema,
  chain: z.string().min(1),
  verified: z.boolean().default(false),
  upstream: z.string().optional(),
});

export type ServiceCard = z.infer<typeof ServiceCardSchema>;

export const RouteSchema = z.enum(["/assess", "/assess/deep"]);

export type Route = z.infer<typeof RouteSchema>;

export const PurchaseIntentSchema = z.object({
  supplier: z.string().min(1),
  route: RouteSchema,
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
