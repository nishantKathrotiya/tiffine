import { z } from "zod";

/** Admin people-management payloads, shared by client forms and handlers. */

export const accountStatusSchema = z.enum(["pending", "approved", "inactive", "rejected"]);

export const setAccountStatusSchema = z.object({
  personId: z.string().uuid("Invalid person."),
  status: accountStatusSchema,
});

export const setAdminRoleSchema = z.object({
  personId: z.string().uuid("Invalid person."),
  isAdmin: z.boolean(),
});

export const mergePeopleSchema = z
  .object({
    sourceId: z.string().uuid("Pick the duplicate account."),
    targetId: z.string().uuid("Pick the account to keep."),
  })
  .refine((data) => data.sourceId !== data.targetId, {
    message: "Pick two different people to merge.",
    path: ["targetId"],
  });

export type SetAccountStatusInput = z.infer<typeof setAccountStatusSchema>;
export type SetAdminRoleInput = z.infer<typeof setAdminRoleSchema>;
export type MergePeopleInput = z.infer<typeof mergePeopleSchema>;
