import { z } from "zod";
import { dateKeySchema } from "./menu";

/** Order payloads, shared by the ordering page and the route handler. */

export const orderLineSchema = z.object({
  menuItemId: z.string().uuid("That item isn't valid."),
  quantity: z
    .number()
    .int("Quantity must be a whole number.")
    .min(1, "Quantity must be at least 1.")
    // Matches the DB check constraint. A slip of the finger on a stepper
    // shouldn't be able to order 200 rotis for the group.
    .max(20, "That's more than 20 — check the quantity."),
});

export const placeOrderSchema = z.object({
  dateKey: dateKeySchema,
  // An empty array clears the order: "not eating today".
  lines: z.array(orderLineSchema).max(30, "That's too many items."),
});

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;
