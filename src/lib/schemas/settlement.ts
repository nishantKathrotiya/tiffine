import { z } from "zod";
import { dateKeySchema } from "./menu";

/** Settlement payloads, shared by the admin UI and the route handlers. */

export const settlementPeriodSchema = z
  .object({
    periodStart: dateKeySchema,
    periodEnd: dateKeySchema,
  })
  .refine((data) => data.periodEnd >= data.periodStart, {
    message: "The end date can't be before the start date.",
    path: ["periodEnd"],
  });

export const commitSettlementSchema = settlementPeriodSchema.safeExtend({
  // Deliberate re-bill of days already inside a committed run.
  includeOverlapping: z.boolean().optional(),
  notes: z.string().trim().max(500, "Keep notes under 500 characters.").optional(),
});

export const providerBillSchema = z.object({
  runId: z.string().uuid("That run isn't valid."),
  // Null clears the recorded invoice amount.
  providerBillPaise: z
    .number()
    .int("Amount must be a whole number of paise.")
    .min(0, "Amount can't be negative.")
    .nullable(),
});

export const paymentStatusSchema = z.object({
  lineId: z.string().uuid("That payment line isn't valid."),
  status: z.enum(["pending", "paid", "waived"]),
});
