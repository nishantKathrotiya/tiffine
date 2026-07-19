import { z } from "zod";
import { passwordSchema } from "@/lib/auth/password";

/**
 * Auth form schemas — imported by both the client form and the server handler.
 *
 * One definition, enforced twice: the client uses it for inline field errors,
 * the server re-runs it because the endpoint is reachable directly.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required.")
  .email("That doesn't look like a valid email address.")
  .max(255, "That email is too long.")
  .transform((value) => value.toLowerCase());

export const nameSchema = z
  .string()
  .trim()
  .min(2, "Please enter your name.")
  .max(80, "That name is too long.");

export const signUpSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Both passwords need to match.",
    path: ["confirmPassword"],
  });

export const signInSchema = z.object({
  email: emailSchema,
  // Deliberately not the full policy: an existing password set under older
  // rules must still be able to sign in.
  password: z.string().min(1, "Please enter your password."),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
