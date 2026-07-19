import "server-only";

import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, orders, people, settlementLines } from "@/lib/db/schema";
import { destroyAllSessionsFor } from "@/lib/auth/session";
import {
  assertCanChangeRole,
  assertIsAdmin,
  type Viewer,
} from "@/lib/auth/permissions";
import { AppError, errors } from "@/lib/api/errors";
import type { AccountStatus } from "@/lib/db/schema";

/**
 * Admin management of people: approval queue, activation, roles, and merging.
 *
 * Every mutation re-checks permissions server-side and writes an audit entry.
 * Hiding a button in the UI is not a control.
 */

export async function listPeople(viewer: Viewer) {
  assertIsAdmin(viewer);

  return db
    .select({
      id: people.id,
      name: people.name,
      email: people.email,
      accountStatus: people.accountStatus,
      isAdmin: people.isAdmin,
      isSuperAdmin: people.isSuperAdmin,
      createdAt: people.createdAt,
      approvedAt: people.approvedAt,
      orderCount: sql<number>`(select count(*)::int from ${orders} where ${orders.personId} = ${people.id})`,
    })
    .from(people)
    .where(isNull(people.mergedIntoId))
    .orderBy(
      // Pending first — the queue Deep needs to act on.
      sql`case when ${people.accountStatus} = 'pending' then 0 else 1 end`,
      asc(people.name),
    );
}

export async function getPendingCount(viewer: Viewer): Promise<number> {
  if (!viewer.isAdmin) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(people)
    .where(and(eq(people.accountStatus, "pending"), isNull(people.mergedIntoId)));
  return row?.count ?? 0;
}

async function loadTarget(personId: string) {
  const [target] = await db
    .select({
      id: people.id,
      name: people.name,
      email: people.email,
      accountStatus: people.accountStatus,
      isAdmin: people.isAdmin,
      isSuperAdmin: people.isSuperAdmin,
      mergedIntoId: people.mergedIntoId,
    })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);

  if (!target) throw errors.notFound("That person");
  if (target.mergedIntoId) {
    throw new AppError("CONFLICT", "That account has already been merged into another.");
  }
  return target;
}

/**
 * Approve, reject, or deactivate an account.
 *
 * Losing ordering access (reject or deactivate) also destroys the person's
 * sessions, so the change applies immediately rather than at token expiry.
 */
export async function setAccountStatus(
  viewer: Viewer,
  personId: string,
  nextStatus: AccountStatus,
): Promise<void> {
  assertIsAdmin(viewer);
  const target = await loadTarget(personId);

  if (target.isSuperAdmin) {
    throw new AppError("FORBIDDEN", "The group owner's account can't be changed.");
  }
  if (target.id === viewer.id) {
    throw new AppError("FORBIDDEN", "You can't change your own account status.");
  }
  if (target.accountStatus === nextStatus) return;

  await db
    .update(people)
    .set({
      accountStatus: nextStatus,
      // approved_at is required by a check constraint whenever status is
      // 'approved'; it also records who let this person in.
      approvedAt: nextStatus === "approved" ? new Date() : null,
      approvedBy: nextStatus === "approved" ? viewer.id : null,
    })
    .where(eq(people.id, personId));

  if (nextStatus === "inactive" || nextStatus === "rejected") {
    await destroyAllSessionsFor(personId);
  }

  await db.insert(auditLog).values({
    actorId: viewer.id,
    action: `account.${nextStatus}`,
    entityType: "person",
    entityId: personId,
    detail: { from: target.accountStatus, to: nextStatus, email: target.email },
  });
}

/**
 * Grant or revoke admin.
 *
 * Any admin may promote; only the super-admin may demote. The asymmetry keeps
 * a mistaken promotion reversible and stops two admins demoting each other.
 */
export async function setAdminRole(
  viewer: Viewer,
  personId: string,
  nextIsAdmin: boolean,
): Promise<void> {
  assertIsAdmin(viewer);
  const target = await loadTarget(personId);

  assertCanChangeRole(viewer, target, nextIsAdmin);

  if (target.accountStatus !== "approved" && nextIsAdmin) {
    throw new AppError(
      "CONFLICT",
      `${target.name} needs to be approved before they can be made an admin.`,
    );
  }
  if (target.isAdmin === nextIsAdmin) return;

  await db.update(people).set({ isAdmin: nextIsAdmin }).where(eq(people.id, personId));

  await db.insert(auditLog).values({
    actorId: viewer.id,
    action: nextIsAdmin ? "role.promote" : "role.demote",
    entityType: "person",
    entityId: personId,
    detail: { email: target.email, isAdmin: nextIsAdmin },
  });
}

/**
 * Merge a duplicate account into the person it belongs to.
 *
 * Because email is self-typed, one human can end up with two rows. Merging
 * reassigns their orders so the settlement bills one person, not two.
 */
export async function mergePeople(
  viewer: Viewer,
  sourceId: string,
  targetId: string,
): Promise<{ ordersMoved: number }> {
  assertIsAdmin(viewer);

  if (sourceId === targetId) {
    throw new AppError("VALIDATION_FAILED", "Pick two different people to merge.");
  }

  const source = await loadTarget(sourceId);
  const target = await loadTarget(targetId);

  if (source.isSuperAdmin) {
    throw new AppError("FORBIDDEN", "The group owner's account can't be merged away.");
  }

  // Orders are unique per (day, person). If both accounts ordered on the same
  // day, moving them blindly would violate that constraint — and silently
  // picking one would change what someone is billed. Refuse and let Deep
  // resolve it explicitly.
  const conflicts = await db
    .select({ menuDayId: orders.menuDayId })
    .from(orders)
    .where(eq(orders.personId, sourceId));

  const targetDays = await db
    .select({ menuDayId: orders.menuDayId })
    .from(orders)
    .where(eq(orders.personId, targetId));

  const targetDaySet = new Set(targetDays.map((row) => row.menuDayId));
  const overlapping = conflicts.filter((row) => targetDaySet.has(row.menuDayId));

  if (overlapping.length > 0) {
    throw new AppError(
      "CONFLICT",
      `Both accounts have orders on ${overlapping.length} of the same day(s). ` +
        `Remove the duplicate orders first, then merge.`,
      { context: { overlappingDays: overlapping.map((row) => row.menuDayId) } },
    );
  }

  const moved = await db
    .update(orders)
    .set({ personId: targetId })
    .where(eq(orders.personId, sourceId))
    .returning({ id: orders.id });

  // Settlement lines are historical records of what was billed, so they stay
  // with the account that was billed. Only future settlements consolidate.
  await db
    .update(people)
    .set({ mergedIntoId: targetId, accountStatus: "inactive" })
    .where(eq(people.id, sourceId));

  await destroyAllSessionsFor(sourceId);

  await db.insert(auditLog).values({
    actorId: viewer.id,
    action: "person.merge",
    entityType: "person",
    entityId: sourceId,
    detail: {
      sourceEmail: source.email,
      targetEmail: target.email,
      ordersMoved: moved.length,
    },
  });

  return { ordersMoved: moved.length };
}

/** Candidates for merging into — everyone active except the source. */
export async function listMergeCandidates(viewer: Viewer, sourceId: string) {
  assertIsAdmin(viewer);
  return db
    .select({ id: people.id, name: people.name, email: people.email })
    .from(people)
    .where(and(ne(people.id, sourceId), isNull(people.mergedIntoId)))
    .orderBy(asc(people.name));
}

/** Outstanding balance per person, for the payments dashboard. */
export async function getOutstandingByPerson(viewer: Viewer) {
  assertIsAdmin(viewer);
  return db
    .select({
      personId: settlementLines.personId,
      name: people.name,
      outstandingPaise: sql<number>`coalesce(sum(${settlementLines.totalPaise}), 0)::bigint`,
    })
    .from(settlementLines)
    .innerJoin(people, eq(people.id, settlementLines.personId))
    .where(eq(settlementLines.paymentStatus, "pending"))
    .groupBy(settlementLines.personId, people.name)
    .orderBy(desc(sql`sum(${settlementLines.totalPaise})`));
}
