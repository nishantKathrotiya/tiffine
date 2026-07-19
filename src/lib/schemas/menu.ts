import { z } from "zod";
import { isValidDateKey } from "@/lib/time";

/** Menu form schemas, shared by the admin form and the route handlers. */

export const dateKeySchema = z
  .string()
  .refine(isValidDateKey, "That isn't a valid date.");

export const menuItemInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Item name is required.")
    .max(60, "Keep item names under 60 characters."),
  // Paise, not rupees: the form converts at the input boundary so no float
  // ever reaches the server.
  unitPricePaise: z
    .number()
    .int("Price must be a whole number of paise.")
    .min(0, "Price can't be negative.")
    .max(10_000_00, "That price looks too high — check the amount."),
});

export const saveMenuSchema = z.object({
  dateKey: dateKeySchema,
  title: z
    .string()
    .trim()
    .min(1, "Give the menu a title, e.g. “Thursday Special”.")
    .max(80, "Keep the title under 80 characters."),
  // Wall-clock time in IST, converted to an instant server-side.
  deadlineTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Enter a time like 10:30."),
  items: z
    .array(menuItemInputSchema)
    .min(1, "Add at least one item.")
    .max(30, "That's a lot of items — keep it under 30."),
});

export const publishMenuSchema = z.object({
  dateKey: dateKeySchema,
});

export type SaveMenuInput = z.infer<typeof saveMenuSchema>;
export type MenuItemInputValues = z.infer<typeof menuItemInputSchema>;
