import "server-only";

import { cookies, headers } from "next/headers";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { people, sessions } from "@/lib/db/schema";
import { canSignIn, type Viewer } from "./permissions";
import { errors } from "@/lib/api/errors";

/**
 * Database-backed sessions.
 *
 * Deliberately not a stateless JWT: an admin deactivating or rejecting an
 * account must take effect on the next request. With a JWT the person would
 * keep ordering until their token expired.
 *
 * The cookie holds a random token; only its SHA-256 hash is stored, so a
 * database leak does not hand over live sessions.
 */

const SESSION_COOKIE = "tiffine_session";
const SESSION_DURATION_DAYS = 30;
/** Refresh `last_used_at` at most once an hour to avoid a write per request. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** SHA-256 of the client IP, for rate limiting without storing addresses. */
async function getIpHash(): Promise<string | null> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? headerList.get("x-real-ip");
  return ip ? createHash("sha256").update(ip).digest("hex") : null;
}

export async function createSession(personId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000);
  const headerList = await headers();

  await db.insert(sessions).values({
    sessionToken: hashToken(token),
    personId,
    expiresAt,
    userAgent: headerList.get("user-agent")?.slice(0, 500) ?? null,
    ipHash: await getIpHash(),
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * Resolve the current viewer, or null when signed out.
 *
 * Account status is read fresh from `people` on every call, so a deactivation
 * applies immediately rather than at token expiry.
 */
export async function getViewer(): Promise<Viewer | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      sessionId: sessions.id,
      lastUsedAt: sessions.lastUsedAt,
      id: people.id,
      name: people.name,
      email: people.email,
      accountStatus: people.accountStatus,
      isAdmin: people.isAdmin,
      isSuperAdmin: people.isSuperAdmin,
      mergedIntoId: people.mergedIntoId,
    })
    .from(sessions)
    .innerJoin(people, eq(people.id, sessions.personId))
    .where(and(eq(sessions.sessionToken, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // A rejected account loses access even if its cookie is still valid.
  if (!canSignIn(row.accountStatus)) return null;

  // A merged person's session must not keep acting as the old identity.
  if (row.mergedIntoId) return null;

  if (Date.now() - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await db
      .update(sessions)
      .set({ lastUsedAt: new Date() })
      .where(eq(sessions.id, row.sessionId));
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    accountStatus: row.accountStatus,
    isAdmin: row.isAdmin,
    isSuperAdmin: row.isSuperAdmin,
  };
}

/** Resolve the viewer or throw — for route handlers that require a session. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) throw errors.unauthenticated();
  return viewer;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await db.delete(sessions).where(eq(sessions.sessionToken, hashToken(token)));
  }
  cookieStore.delete(SESSION_COOKIE);
}

/** Sign out every device for a person — used when an admin deactivates them. */
export async function destroyAllSessionsFor(personId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.personId, personId));
}

/** Housekeeping for the deadline sweeper: drop expired rows. */
export async function pruneExpiredSessions(): Promise<number> {
  const result = await db
    .delete(sessions)
    .where(sql`${sessions.expiresAt} < now()`)
    .returning({ id: sessions.id });
  return result.length;
}

export { getIpHash, hashToken, timingSafeEqual };
