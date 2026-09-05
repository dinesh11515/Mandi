import { z } from "zod";

export const DecisionStatusSchema = z.enum(["approved", "rejected"]);

export const DecisionSchema = z.object({
  status: DecisionStatusSchema,
  reasons: z.array(z.string()),
  supplier: z.string().min(1),
});

export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
