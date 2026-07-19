import { z } from "zod";
import { dateKeySchema, menuItemInputSchema } from "./menu";

/** Day-lifecycle and cancellation payloads. */

export const lockDaySchema = z.object({ dateKey: dateKeySchema });

export const markSentSchema = z.object({ dateKey: dateKeySchema });

export const openRepollSchema = z.object({
  dateKey: dateKeySchema,
  reason: z
    .string()
    .trim()
    .min(1, "Say why you're re-polling — people will see this.")
    .max(200, "Keep the reason under 200 characters."),
  deadlineTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Enter a time like 11:15."),
  // Items from the previous round that are still available.
  keepItemIds: z.array(z.string().uuid()),
  // Replacements the provider is offering instead.
  newItems: z.array(menuItemInputSchema).max(20, "That's a lot of replacements."),
});

export const requestCancellationSchema = z.object({
  dateKey: dateKeySchema,
  reason: z.string().trim().max(200, "Keep it under 200 characters.").optional(),
});

export const decideCancellationSchema = z.object({
  requestId: z.string().uuid("That request isn't valid."),
  approve: z.boolean(),
  note: z.string().trim().max(200, "Keep the note under 200 characters.").optional(),
});

export type OpenRepollInput = z.infer<typeof openRepollSchema>;
export type DecideCancellationInput = z.infer<typeof decideCancellationSchema>;
