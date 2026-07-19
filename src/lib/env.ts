import { z } from "zod";

/**
 * Environment validation.
 *
 * Parsed once at module load so a missing or malformed variable fails the boot
 * rather than throwing at 10:30 on a weekday when Deep is publishing a menu.
 */

const serverSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid Neon connection string"),

  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 characters — generate with `openssl rand -base64 32`"),


  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().startsWith("mailto:").optional(),

  CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 characters").optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  NEXT_PUBLIC_UPI_PAYEE_VPA: z.string().optional(),
  NEXT_PUBLIC_UPI_PAYEE_NAME: z.string().optional(),
});

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
}

function parseServerEnv() {
  // Skip during `next build`'s static analysis, where secrets are absent by
  // design; the running server still validates on first import.
  if (process.env.SKIP_ENV_VALIDATION === "true") {
    return process.env as unknown as z.infer<typeof serverSchema>;
  }

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment variables:\n${formatIssues(parsed.error)}\n\n` +
        `Copy .env.example to .env.local and fill in the missing values.`,
    );
  }
  return parsed.data;
}

function parseClientEnv() {
  if (process.env.SKIP_ENV_VALIDATION === "true") {
    return process.env as unknown as z.infer<typeof clientSchema>;
  }

  // Next.js inlines NEXT_PUBLIC_* at build time, so these must be referenced
  // explicitly rather than read dynamically off process.env.
  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    NEXT_PUBLIC_UPI_PAYEE_VPA: process.env.NEXT_PUBLIC_UPI_PAYEE_VPA,
    NEXT_PUBLIC_UPI_PAYEE_NAME: process.env.NEXT_PUBLIC_UPI_PAYEE_NAME,
  });

  if (!parsed.success) {
    throw new Error(`Invalid public environment variables:\n${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

/** Server-only. Importing this from a client component is a build error. */
export const env = parseServerEnv();

export const publicEnv = parseClientEnv();
