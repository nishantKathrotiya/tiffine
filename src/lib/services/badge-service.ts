import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cancellationRequests, people } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/permissions";
import { isActiveAdmin } from "@/lib/auth/permissions";

/**
 * Badge counts for the admin nav.
 *
 * One query and one call site: every page previously fetched its own
 * `pendingCount`, so adding a second badge would have meant editing fifteen
 * pages and hoping none drifted. `AppShell` now takes this whole object.
 *
 * Returns zeroes for non-admins rather than throwing — the shell renders for
 * everyone, and a member simply has no badges.
 */
export type BadgeCounts = {
  /** Signups waiting for approval. */
  pendingMembers: number;
  /** Cancellation requests waiting for a decision. */
  pendingCancellations: number;
};

export const NO_BADGES: BadgeCounts = { pendingMembers: 0, pendingCancellations: 0 };

export async function getBadgeCounts(viewer: Viewer | null): Promise<BadgeCounts> {
  if (!viewer || !isActiveAdmin(viewer)) return NO_BADGES;

  // Both counts in a single round trip — this runs on every admin page load.
  const [row] = await db
    .select({
      pendingMembers: sql<number>`(
        select count(*)::int from people
         where account_status = 'pending' and merged_into_id is null
      )`,
      pendingCancellations: sql<number>`(
        select count(*)::int from cancellation_requests where status = 'pending'
      )`,
    })
    .from(sql`(select 1) as _`);

  return {
    pendingMembers: row?.pendingMembers ?? 0,
    pendingCancellations: row?.pendingCancellations ?? 0,
  };
}

/** Kept for callers that only need the approval count (e.g. page copy). */
export async function getPendingMemberCount(viewer: Viewer | null): Promise<number> {
  if (!viewer || !isActiveAdmin(viewer)) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(people)
    .where(and(eq(people.accountStatus, "pending"), isNull(people.mergedIntoId)));
  return row?.count ?? 0;
}

export async function getPendingCancellationCount(viewer: Viewer | null): Promise<number> {
  if (!viewer || !isActiveAdmin(viewer)) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cancellationRequests)
    .where(eq(cancellationRequests.status, "pending"));
  return row?.count ?? 0;
}
