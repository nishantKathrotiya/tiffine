import "server-only";

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { authAttempts, auditLog, people } from "@/lib/db/schema";
import { fakeVerifyPassword, hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, getIpHash } from "@/lib/auth/session";
import { canSignIn } from "@/lib/auth/permissions";
import { AppError } from "@/lib/api/errors";

/**
 * Sign-up and sign-in.
 *
 * New accounts land in `pending` and cannot order until an admin approves
 * them. There is no email verification step — admin approval replaces it.
 */

const MAX_ATTEMPTS_PER_EMAIL = 8;
const MAX_ATTEMPTS_PER_IP = 20;
const ATTEMPT_WINDOW_MINUTES = 15;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Throttle sign-in attempts by email and by IP.
 *
 * Without this, a 15-person app with self-chosen passwords is trivially
 * brute-forceable. Both dimensions are needed: per-email stops one account
 * being hammered, per-IP stops one attacker spraying many accounts.
 */
async function assertNotRateLimited(email: string, ipHash: string | null): Promise<void> {
  const windowStart = new Date(Date.now() - ATTEMPT_WINDOW_MINUTES * 60 * 1000);

  const [emailFailures] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(authAttempts)
    .where(
      and(
        eq(sql`lower(${authAttempts.email})`, email),
        eq(authAttempts.succeeded, false),
        gte(authAttempts.attemptedAt, windowStart),
      ),
    );

  if ((emailFailures?.count ?? 0) >= MAX_ATTEMPTS_PER_EMAIL) {
    throw new AppError(
      "FORBIDDEN",
      `Too many sign-in attempts. Please wait ${ATTEMPT_WINDOW_MINUTES} minutes and try again.`,
      { status: 429 },
    );
  }

  if (ipHash) {
    const [ipFailures] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(authAttempts)
      .where(
        and(
          eq(authAttempts.ipHash, ipHash),
          eq(authAttempts.succeeded, false),
          gte(authAttempts.attemptedAt, windowStart),
        ),
      );

    if ((ipFailures?.count ?? 0) >= MAX_ATTEMPTS_PER_IP) {
      throw new AppError(
        "FORBIDDEN",
        `Too many sign-in attempts from this device. Please wait ${ATTEMPT_WINDOW_MINUTES} minutes.`,
        { status: 429 },
      );
    }
  }
}

async function recordAttempt(email: string, ipHash: string | null, succeeded: boolean) {
  await db.insert(authAttempts).values({ email, ipHash, succeeded });
}

export async function signUp(input: {
  email: string;
  password: string;
  name: string;
}): Promise<{ personId: string; accountStatus: string }> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();

  const existing = await db
    .select({ id: people.id, passwordHash: people.passwordHash })
    .from(people)
    .where(eq(people.email, email))
    .limit(1);

  const found = existing[0];

  // An admin may have seeded this person without a password; that row is
  // claimed here rather than colliding.
  if (found && found.passwordHash === null) {
    const passwordHash = await hashPassword(input.password);
    await db
      .update(people)
      .set({ passwordHash, name })
      .where(eq(people.id, found.id));
    await createSession(found.id);

    const [updated] = await db
      .select({ accountStatus: people.accountStatus })
      .from(people)
      .where(eq(people.id, found.id))
      .limit(1);
    return { personId: found.id, accountStatus: updated.accountStatus };
  }

  if (found) {
    throw new AppError(
      "DUPLICATE",
      "An account with this email already exists. Try signing in instead.",
      { fields: { email: "This email is already registered." } },
    );
  }

  const passwordHash = await hashPassword(input.password);

  const [created] = await db
    .insert(people)
    .values({ email, name, passwordHash, accountStatus: "pending" })
    .returning({ id: people.id, accountStatus: people.accountStatus });

  await db.insert(auditLog).values({
    actorId: created.id,
    action: "account.signup",
    entityType: "person",
    entityId: created.id,
    detail: { email, name },
  });

  await createSession(created.id);
  return { personId: created.id, accountStatus: created.accountStatus };
}

export async function signIn(input: { email: string; password: string }): Promise<{
  personId: string;
  accountStatus: string;
}> {
  const email = normalizeEmail(input.email);
  const ipHash = await getIpHash();

  await assertNotRateLimited(email, ipHash);

  const rows = await db
    .select({
      id: people.id,
      passwordHash: people.passwordHash,
      accountStatus: people.accountStatus,
      mergedIntoId: people.mergedIntoId,
    })
    .from(people)
    .where(eq(people.email, email))
    .limit(1);

  const person = rows[0];

  // Identical failure path and comparable timing whether or not the account
  // exists, so this cannot be used to discover who is registered.
  if (!person || !person.passwordHash) {
    await fakeVerifyPassword();
    await recordAttempt(email, ipHash, false);
    throw invalidCredentials();
  }

  const passwordMatches = await verifyPassword(input.password, person.passwordHash);
  if (!passwordMatches) {
    await recordAttempt(email, ipHash, false);
    throw invalidCredentials();
  }

  if (person.mergedIntoId) {
    await recordAttempt(email, ipHash, false);
    throw new AppError(
      "FORBIDDEN",
      "This account has been merged into another. Please sign in with your other email.",
    );
  }

  if (!canSignIn(person.accountStatus)) {
    await recordAttempt(email, ipHash, false);
    throw new AppError("FORBIDDEN", "Your account request was declined.");
  }

  await recordAttempt(email, ipHash, true);
  await createSession(person.id);

  return { personId: person.id, accountStatus: person.accountStatus };
}

function invalidCredentials(): AppError {
  // Never distinguish "no such account" from "wrong password".
  return new AppError("UNAUTHENTICATED", "That email or password isn't right. Please try again.", {
    status: 401,
  });
}

/** Most recent sign-in attempts for an email — surfaced in admin diagnostics. */
export async function getRecentAttempts(email: string, limit = 10) {
  return db
    .select()
    .from(authAttempts)
    .where(eq(sql`lower(${authAttempts.email})`, normalizeEmail(email)))
    .orderBy(desc(authAttempts.attemptedAt))
    .limit(limit);
}
