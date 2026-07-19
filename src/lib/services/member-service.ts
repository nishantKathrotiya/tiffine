import "server-only";

import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { menuDays, orders, people, settlementLines, settlementRuns } from "@/lib/db/schema";
import { assertIsAdmin, type Viewer } from "@/lib/auth/permissions";
import { errors } from "@/lib/api/errors";
import { getOrderHistory } from "./order-service";
import { sumPaise, type Paise } from "@/lib/money";

/**
 * Admin view of an individual member: who they are, what they've ordered, and
 * what they owe.
 *
 * Answers the question Deep gets asked directly — "what am I paying for?" —
 * without him scrolling a settlement run to find one person's line.
 */

/**
 * People list for the admin directory, optionally filtered by a search term.
 *
 * Matching is server-side rather than client-side filtering, so it stays
 * correct if the group ever outgrows a single page of results.
 */
export async function searchMembers(viewer: Viewer, query?: string) {
  assertIsAdmin(viewer);

  const term = query?.trim().toLowerCase();
  // Escape LIKE wildcards so a literal % or _ in a search doesn't match
  // everything.
  const pattern = term ? `%${term.replace(/[%_\\]/g, "\\$&")}%` : null;

  return db
    .select({
      id: people.id,
      name: people.name,
      email: people.email,
      accountStatus: people.accountStatus,
      isAdmin: people.isAdmin,
      isSuperAdmin: people.isSuperAdmin,
      // Table names are written literally inside these correlated subqueries.
      // Interpolating the Drizzle column refs emits them unqualified, which
      // Postgres rejects as ambiguous once the subquery joins another table
      // that also has an `id`.
      orderCount: sql<number>`(
        select count(*)::int from orders o
         where o.person_id = people.id and o.status = 'active'
      )`,
      lifetimePaise: sql<string>`coalesce((
        select sum(ol.quantity * ol.unit_price_paise_snapshot)
          from orders o
          join order_lines ol on ol.order_id = o.id
         where o.person_id = people.id and o.status = 'active'
      ), 0)::bigint`,
      outstandingPaise: sql<string>`coalesce((
        select sum(sl.total_paise)
          from settlement_lines sl
          join settlement_runs sr on sr.id = sl.settlement_run_id
         where sl.person_id = people.id
           and sl.payment_status = 'pending'
           and sr.status = 'committed'
      ), 0)::bigint`,
    })
    .from(people)
    .where(
      and(
        // Merged duplicates would show as phantom people with no orders.
        isNull(people.mergedIntoId),
        pattern
          ? or(
              sql`lower(${people.name}) like ${pattern} escape '\\'`,
              sql`lower(${people.email}) like ${pattern} escape '\\'`,
            )
          : undefined,
      ),
    )
    .orderBy(asc(people.name))
    .then((rows) =>
      rows.map((row) => ({
        ...row,
        lifetimePaise: Number(row.lifetimePaise),
        outstandingPaise: Number(row.outstandingPaise),
      })),
    );
}

export type MemberDetail = {
  person: {
    id: string;
    name: string;
    email: string;
    accountStatus: string;
    isAdmin: boolean;
    isSuperAdmin: boolean;
    createdAt: Date;
  };
  orders: Awaited<ReturnType<typeof getOrderHistory>>;
  rangeTotalPaise: Paise;
  rangeDayCount: number;
  outstandingPaise: Paise;
  payments: {
    runId: string;
    periodStart: string;
    periodEnd: string;
    totalPaise: Paise;
    paymentStatus: string;
  }[];
};

/**
 * One member's orders over a date range, plus their settlement lines.
 *
 * Cancelled orders are listed (so a "why isn't this billed?" question is
 * answerable) but contribute zero to the range total — an approved
 * cancellation means no tiffin and no charge.
 */
export async function getMemberDetail(
  viewer: Viewer,
  personId: string,
  range: { fromDateKey?: string; toDateKey?: string } = {},
): Promise<MemberDetail> {
  assertIsAdmin(viewer);

  const [person] = await db
    .select({
      id: people.id,
      name: people.name,
      email: people.email,
      accountStatus: people.accountStatus,
      isAdmin: people.isAdmin,
      isSuperAdmin: people.isSuperAdmin,
      createdAt: people.createdAt,
    })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);

  if (!person) throw errors.notFound("That person");

  const history = await getOrderHistory(personId, {
    limit: 400,
    fromDateKey: range.fromDateKey,
    toDateKey: range.toDateKey,
  });

  const billable = history.filter((entry) => entry.status !== "cancelled");

  const [outstanding] = await db
    .select({
      total: sql<string>`coalesce(sum(${settlementLines.totalPaise}), 0)::bigint`,
    })
    .from(settlementLines)
    .innerJoin(settlementRuns, eq(settlementRuns.id, settlementLines.settlementRunId))
    .where(
      and(
        eq(settlementLines.personId, personId),
        eq(settlementLines.paymentStatus, "pending"),
        eq(settlementRuns.status, "committed"),
      ),
    );

  const payments = await db
    .select({
      runId: settlementRuns.id,
      periodStart: settlementRuns.periodStart,
      periodEnd: settlementRuns.periodEnd,
      totalPaise: settlementLines.totalPaise,
      paymentStatus: settlementLines.paymentStatus,
    })
    .from(settlementLines)
    .innerJoin(settlementRuns, eq(settlementRuns.id, settlementLines.settlementRunId))
    .where(
      and(eq(settlementLines.personId, personId), eq(settlementRuns.status, "committed")),
    )
    .orderBy(desc(settlementRuns.periodEnd));

  return {
    person,
    orders: history,
    rangeTotalPaise: sumPaise(billable.map((entry) => entry.totalPaise)),
    rangeDayCount: billable.length,
    outstandingPaise: Number(outstanding?.total ?? 0),
    payments: payments.map((row) => ({
      ...row,
      periodStart: String(row.periodStart),
      periodEnd: String(row.periodEnd),
      totalPaise: Number(row.totalPaise),
    })),
  };
}

/** Earliest and latest days this person ordered — used to bound the picker. */
export async function getMemberOrderBounds(viewer: Viewer, personId: string) {
  assertIsAdmin(viewer);

  const [row] = await db
    .select({
      first: sql<string | null>`min(${menuDays.dateKey})::text`,
      last: sql<string | null>`max(${menuDays.dateKey})::text`,
    })
    .from(orders)
    .innerJoin(menuDays, eq(menuDays.id, orders.menuDayId))
    .where(eq(orders.personId, personId));

  return { first: row?.first ?? null, last: row?.last ?? null };
}

export { gte, lte };
