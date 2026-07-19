import "server-only";

import { and, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLog,
  menuDays,
  orderLines,
  orders,
  people,
  settledDays,
  settlementLines,
  settlementRuns,
} from "@/lib/db/schema";
import { assertIsAdmin, type Viewer } from "@/lib/auth/permissions";
import { AppError, errors } from "@/lib/api/errors";
import { sumPaise, type Paise } from "@/lib/money";
import { eachDateKeyInRange, formatDayShort, type DateKey } from "@/lib/time";

/**
 * Settlement: turning a date range into per-person amounts owed.
 *
 * Two invariants hold throughout, because everything else depends on them:
 *
 *   1. Totals are computed from `unit_price_paise_snapshot`, never from live
 *      menu prices. A mid-period price change must not re-bill past days.
 *   2. Cancelled orders contribute zero. An approved cancellation means no
 *      tiffin and no charge.
 *
 * A day may belong to at most one committed run (enforced by a unique index on
 * settled_days), so a day cannot be billed twice — and the gap report below
 * catches the opposite failure, a day that was never billed at all.
 */

export type PersonTotal = {
  personId: string;
  name: string;
  email: string;
  totalPaise: Paise;
  dayCount: number;
};

export type SettlementPreview = {
  periodStart: DateKey;
  periodEnd: DateKey;
  perPerson: PersonTotal[];
  totalPaise: Paise;
  dayCount: number;
  /** Days in range already billed by a committed run. */
  overlappingDays: { dateKey: DateKey; runId: string; runLabel: string }[];
  /** Billable days in range that no committed run covers. */
  includedDays: { menuDayId: string; dateKey: DateKey }[];
};

/**
 * Which days in a range are billable.
 *
 * A day counts once it has been closed — `locked`, `sent_to_provider`, or
 * already `settled`. Drafts and still-open days are excluded: their counts can
 * still change, and billing a moving target is how totals stop reconciling.
 */
const BILLABLE_STATUSES = ["locked", "sent_to_provider", "settled"] as const;

export async function previewSettlement(
  viewer: Viewer,
  input: { periodStart: DateKey; periodEnd: DateKey },
): Promise<SettlementPreview> {
  assertIsAdmin(viewer);

  if (input.periodEnd < input.periodStart) {
    throw errors.invalidPeriod("The end date can't be before the start date.", {
      periodEnd: "Must be on or after the start date.",
    });
  }

  const days = await db
    .select({ id: menuDays.id, dateKey: menuDays.dateKey, status: menuDays.status })
    .from(menuDays)
    .where(
      and(
        gte(menuDays.dateKey, input.periodStart),
        lte(menuDays.dateKey, input.periodEnd),
        inArray(menuDays.status, [...BILLABLE_STATUSES]),
      ),
    )
    .orderBy(menuDays.dateKey);

  const dayIds = days.map((day) => day.id);

  // Days already inside a committed run. Flagged rather than silently skipped:
  // Deep must decide whether this is a mistake or a deliberate re-bill.
  const overlapping = dayIds.length
    ? await db
        .select({
          dateKey: menuDays.dateKey,
          runId: settlementRuns.id,
          periodStart: settlementRuns.periodStart,
          periodEnd: settlementRuns.periodEnd,
        })
        .from(settledDays)
        .innerJoin(menuDays, eq(menuDays.id, settledDays.menuDayId))
        .innerJoin(settlementRuns, eq(settlementRuns.id, settledDays.settlementRunId))
        .where(
          and(
            inArray(settledDays.menuDayId, dayIds),
            eq(settlementRuns.status, "committed"),
          ),
        )
    : [];

  const overlappingKeys = new Set(overlapping.map((row) => String(row.dateKey)));
  const includedDays = days
    .filter((day) => !overlappingKeys.has(String(day.dateKey)))
    .map((day) => ({ menuDayId: day.id, dateKey: String(day.dateKey) as DateKey }));

  const perPerson = await computePersonTotals(includedDays.map((day) => day.menuDayId));

  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    perPerson,
    totalPaise: sumPaise(perPerson.map((row) => row.totalPaise)),
    dayCount: includedDays.length,
    overlappingDays: overlapping.map((row) => ({
      dateKey: String(row.dateKey) as DateKey,
      runId: row.runId,
      runLabel: `${formatDayShort(String(row.periodStart))} – ${formatDayShort(String(row.periodEnd))}`,
    })),
    includedDays,
  };
}

/**
 * Per-person totals from snapshotted line prices.
 *
 * Cancelled orders are excluded by the status filter, so an approved
 * cancellation contributes nothing.
 */
async function computePersonTotals(menuDayIds: string[]): Promise<PersonTotal[]> {
  if (menuDayIds.length === 0) return [];

  const rows = await db
    .select({
      personId: orders.personId,
      name: people.name,
      email: people.email,
      totalPaise: sql<string>`coalesce(sum(${orderLines.quantity} * ${orderLines.unitPricePaiseSnapshot}), 0)::bigint`,
      dayCount: sql<number>`count(distinct ${orders.menuDayId})::int`,
    })
    .from(orders)
    .innerJoin(people, eq(people.id, orders.personId))
    .innerJoin(orderLines, eq(orderLines.orderId, orders.id))
    .where(and(inArray(orders.menuDayId, menuDayIds), eq(orders.status, "active")))
    .groupBy(orders.personId, people.name, people.email)
    .orderBy(people.name);

  return rows.map((row) => ({
    personId: row.personId,
    name: row.name,
    email: row.email,
    // bigint arrives as a string; Number() before any arithmetic so a total
    // never becomes a string concatenation.
    totalPaise: Number(row.totalPaise),
    dayCount: row.dayCount,
  }));
}

/**
 * Commit a settlement run.
 *
 * Recomputes from scratch rather than trusting a preview the client sent back —
 * the preview may be minutes stale, and the amounts people are asked to pay
 * must come from the database at commit time.
 */
export async function commitSettlement(
  viewer: Viewer,
  input: {
    periodStart: DateKey;
    periodEnd: DateKey;
    /** Deliberately re-bill days already inside a committed run. */
    includeOverlapping?: boolean;
    notes?: string;
  },
): Promise<{ runId: string; totalPaise: Paise; personCount: number }> {
  assertIsAdmin(viewer);

  const preview = await previewSettlement(viewer, input);

  if (preview.overlappingDays.length > 0 && !input.includeOverlapping) {
    throw errors.periodOverlap(preview.overlappingDays[0].runLabel);
  }

  const dayIds = input.includeOverlapping
    ? await resolveAllBillableDayIds(input.periodStart, input.periodEnd)
    : preview.includedDays.map((day) => day.menuDayId);

  if (dayIds.length === 0) {
    throw new AppError(
      "INVALID_PERIOD",
      "No closed days in that range to bill. Days are billable once ordering has closed.",
    );
  }

  const perPerson = await computePersonTotals(dayIds);

  if (perPerson.length === 0) {
    throw new AppError("INVALID_PERIOD", "Nobody ordered in that range, so there's nothing to bill.");
  }

  const totalPaise = sumPaise(perPerson.map((row) => row.totalPaise));

  const [run] = await db
    .insert(settlementRuns)
    .values({
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: "committed",
      totalPaise,
      notes: input.notes?.trim() || null,
      generatedBy: viewer.id,
      committedAt: new Date(),
    })
    .returning({ id: settlementRuns.id });

  await db.insert(settlementLines).values(
    perPerson.map((row) => ({
      settlementRunId: run.id,
      personId: row.personId,
      totalPaise: row.totalPaise,
      paymentStatus: "pending" as const,
    })),
  );

  // Claim the days. The unique index on settled_days.menu_day_id means a day
  // already claimed by another committed run cannot be inserted twice, so
  // re-billing requires releasing it first (below).
  if (input.includeOverlapping) {
    await db.delete(settledDays).where(inArray(settledDays.menuDayId, dayIds));
  }
  await db.insert(settledDays).values(
    dayIds.map((menuDayId) => ({ settlementRunId: run.id, menuDayId })),
  );

  await db.update(menuDays).set({ status: "settled" }).where(inArray(menuDays.id, dayIds));

  await db.insert(auditLog).values({
    actorId: viewer.id,
    action: "settlement.commit",
    entityType: "settlement_run",
    entityId: run.id,
    detail: {
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      dayCount: dayIds.length,
      personCount: perPerson.length,
      totalPaise,
      includeOverlapping: input.includeOverlapping ?? false,
    },
  });

  return { runId: run.id, totalPaise, personCount: perPerson.length };
}

async function resolveAllBillableDayIds(start: DateKey, end: DateKey): Promise<string[]> {
  const days = await db
    .select({ id: menuDays.id })
    .from(menuDays)
    .where(
      and(
        gte(menuDays.dateKey, start),
        lte(menuDays.dateKey, end),
        inArray(menuDays.status, [...BILLABLE_STATUSES]),
      ),
    );
  return days.map((day) => day.id);
}

/** All runs, newest first, with collected-vs-outstanding figures. */
export async function listSettlementRuns(viewer: Viewer) {
  assertIsAdmin(viewer);

  const rows = await db
    .select({
      id: settlementRuns.id,
      periodStart: settlementRuns.periodStart,
      periodEnd: settlementRuns.periodEnd,
      status: settlementRuns.status,
      totalPaise: settlementRuns.totalPaise,
      providerBillPaise: settlementRuns.providerBillPaise,
      committedAt: settlementRuns.committedAt,
      generatedAt: settlementRuns.generatedAt,
      personCount: sql<number>`(select count(*)::int from ${settlementLines} where ${settlementLines.settlementRunId} = ${settlementRuns.id})`,
      paidPaise: sql<string>`coalesce((select sum(${settlementLines.totalPaise}) from ${settlementLines}
        where ${settlementLines.settlementRunId} = ${settlementRuns.id}
          and ${settlementLines.paymentStatus} = 'paid'), 0)::bigint`,
      pendingPaise: sql<string>`coalesce((select sum(${settlementLines.totalPaise}) from ${settlementLines}
        where ${settlementLines.settlementRunId} = ${settlementRuns.id}
          and ${settlementLines.paymentStatus} = 'pending'), 0)::bigint`,
    })
    .from(settlementRuns)
    .where(ne(settlementRuns.status, "voided"))
    .orderBy(desc(settlementRuns.periodEnd));

  return rows.map((row) => ({
    ...row,
    totalPaise: Number(row.totalPaise),
    providerBillPaise: row.providerBillPaise === null ? null : Number(row.providerBillPaise),
    paidPaise: Number(row.paidPaise),
    pendingPaise: Number(row.pendingPaise),
  }));
}

/** One run in detail, including the provider-bill reconciliation. */
export async function getSettlementRun(viewer: Viewer, runId: string) {
  assertIsAdmin(viewer);

  const [run] = await db.select().from(settlementRuns).where(eq(settlementRuns.id, runId)).limit(1);
  if (!run) throw errors.notFound("That settlement run");

  const lines = await db
    .select({
      id: settlementLines.id,
      personId: settlementLines.personId,
      name: people.name,
      email: people.email,
      totalPaise: settlementLines.totalPaise,
      paymentStatus: settlementLines.paymentStatus,
      paidAt: settlementLines.paidAt,
    })
    .from(settlementLines)
    .innerJoin(people, eq(people.id, settlementLines.personId))
    .where(eq(settlementLines.settlementRunId, runId))
    .orderBy(people.name);

  const days = await db
    .select({ dateKey: menuDays.dateKey, title: menuDays.title })
    .from(settledDays)
    .innerJoin(menuDays, eq(menuDays.id, settledDays.menuDayId))
    .where(eq(settledDays.settlementRunId, runId))
    .orderBy(menuDays.dateKey);

  const normalizedLines = lines.map((line) => ({
    ...line,
    totalPaise: Number(line.totalPaise),
  }));

  const systemTotal = Number(run.totalPaise);
  const providerBill = run.providerBillPaise === null ? null : Number(run.providerBillPaise);

  return {
    run: { ...run, totalPaise: systemTotal, providerBillPaise: providerBill },
    lines: normalizedLines,
    days: days.map((day) => ({ ...day, dateKey: String(day.dateKey) })),
    // Positive means the provider billed more than the system expected.
    // Surfaced before money is collected, not after.
    reconciliation:
      providerBill === null
        ? null
        : { deltaPaise: providerBill - systemTotal, matches: providerBill === systemTotal },
    collectedPaise: sumPaise(
      normalizedLines.filter((l) => l.paymentStatus === "paid").map((l) => l.totalPaise),
    ),
    outstandingPaise: sumPaise(
      normalizedLines.filter((l) => l.paymentStatus === "pending").map((l) => l.totalPaise),
    ),
  };
}

/** Record what the provider actually invoiced, for reconciliation. */
export async function setProviderBill(
  viewer: Viewer,
  input: { runId: string; providerBillPaise: Paise | null },
): Promise<void> {
  assertIsAdmin(viewer);

  const [run] = await db
    .select()
    .from(settlementRuns)
    .where(eq(settlementRuns.id, input.runId))
    .limit(1);
  if (!run) throw errors.notFound("That settlement run");

  await db
    .update(settlementRuns)
    .set({ providerBillPaise: input.providerBillPaise })
    .where(eq(settlementRuns.id, input.runId));

  await db.insert(auditLog).values({
    actorId: viewer.id,
    action: "settlement.provider_bill",
    entityType: "settlement_run",
    entityId: input.runId,
    detail: { providerBillPaise: input.providerBillPaise, systemTotal: Number(run.totalPaise) },
  });
}

/** Mark a person's line paid, unpaid, or waived. */
export async function setPaymentStatus(
  viewer: Viewer,
  input: { lineId: string; status: "pending" | "paid" | "waived" },
): Promise<void> {
  assertIsAdmin(viewer);

  const [line] = await db
    .select()
    .from(settlementLines)
    .where(eq(settlementLines.id, input.lineId))
    .limit(1);
  if (!line) throw errors.notFound("That payment line");

  await db
    .update(settlementLines)
    .set({
      paymentStatus: input.status,
      paidAt: input.status === "paid" ? new Date() : null,
      markedBy: viewer.id,
    })
    .where(eq(settlementLines.id, input.lineId));

  await db.insert(auditLog).values({
    actorId: viewer.id,
    action: `payment.${input.status}`,
    entityType: "settlement_line",
    entityId: input.lineId,
    detail: { personId: line.personId, totalPaise: Number(line.totalPaise) },
  });
}

/**
 * Billable days in a range that no committed run covers.
 *
 * The counterpart to overlap detection: billing 1–20 Jul then 22 Jul–5 Aug
 * silently loses the 21st. This is what surfaces that.
 */
export async function findUnbilledGaps(
  viewer: Viewer,
  input: { periodStart: DateKey; periodEnd: DateKey },
): Promise<DateKey[]> {
  assertIsAdmin(viewer);

  const billable = await db
    .select({ id: menuDays.id, dateKey: menuDays.dateKey })
    .from(menuDays)
    .where(
      and(
        gte(menuDays.dateKey, input.periodStart),
        lte(menuDays.dateKey, input.periodEnd),
        inArray(menuDays.status, [...BILLABLE_STATUSES]),
      ),
    );

  if (billable.length === 0) return [];

  const claimed = await db
    .select({ menuDayId: settledDays.menuDayId })
    .from(settledDays)
    .innerJoin(settlementRuns, eq(settlementRuns.id, settledDays.settlementRunId))
    .where(
      and(
        inArray(settledDays.menuDayId, billable.map((day) => day.id)),
        eq(settlementRuns.status, "committed"),
      ),
    );

  const claimedIds = new Set(claimed.map((row) => row.menuDayId));
  return billable
    .filter((day) => !claimedIds.has(day.id))
    .map((day) => String(day.dateKey) as DateKey);
}

/** A person's own settlement lines, for /me/payments. */
export async function getMyPayments(personId: string) {
  const rows = await db
    .select({
      lineId: settlementLines.id,
      runId: settlementRuns.id,
      periodStart: settlementRuns.periodStart,
      periodEnd: settlementRuns.periodEnd,
      totalPaise: settlementLines.totalPaise,
      paymentStatus: settlementLines.paymentStatus,
      paidAt: settlementLines.paidAt,
      committedAt: settlementRuns.committedAt,
    })
    .from(settlementLines)
    .innerJoin(settlementRuns, eq(settlementRuns.id, settlementLines.settlementRunId))
    .where(
      and(eq(settlementLines.personId, personId), eq(settlementRuns.status, "committed")),
    )
    .orderBy(desc(settlementRuns.periodEnd));

  return rows.map((row) => ({
    ...row,
    totalPaise: Number(row.totalPaise),
    periodStart: String(row.periodStart),
    periodEnd: String(row.periodEnd),
  }));
}

/** Group-wide collected vs outstanding, for the payments dashboard. */
export async function getPaymentsOverview(viewer: Viewer) {
  assertIsAdmin(viewer);

  const [totals] = await db
    .select({
      collectedPaise: sql<string>`coalesce(sum(case when ${settlementLines.paymentStatus} = 'paid' then ${settlementLines.totalPaise} else 0 end), 0)::bigint`,
      outstandingPaise: sql<string>`coalesce(sum(case when ${settlementLines.paymentStatus} = 'pending' then ${settlementLines.totalPaise} else 0 end), 0)::bigint`,
      waivedPaise: sql<string>`coalesce(sum(case when ${settlementLines.paymentStatus} = 'waived' then ${settlementLines.totalPaise} else 0 end), 0)::bigint`,
    })
    .from(settlementLines)
    .innerJoin(settlementRuns, eq(settlementRuns.id, settlementLines.settlementRunId))
    .where(eq(settlementRuns.status, "committed"));

  const byPerson = await db
    .select({
      personId: settlementLines.personId,
      name: people.name,
      outstandingPaise: sql<string>`coalesce(sum(case when ${settlementLines.paymentStatus} = 'pending' then ${settlementLines.totalPaise} else 0 end), 0)::bigint`,
    })
    .from(settlementLines)
    .innerJoin(people, eq(people.id, settlementLines.personId))
    .innerJoin(settlementRuns, eq(settlementRuns.id, settlementLines.settlementRunId))
    .where(eq(settlementRuns.status, "committed"))
    .groupBy(settlementLines.personId, people.name)
    .orderBy(desc(sql`sum(case when ${settlementLines.paymentStatus} = 'pending' then ${settlementLines.totalPaise} else 0 end)`));

  return {
    collectedPaise: Number(totals?.collectedPaise ?? 0),
    outstandingPaise: Number(totals?.outstandingPaise ?? 0),
    waivedPaise: Number(totals?.waivedPaise ?? 0),
    byPerson: byPerson
      .map((row) => ({ ...row, outstandingPaise: Number(row.outstandingPaise) }))
      .filter((row) => row.outstandingPaise > 0),
  };
}

export { eachDateKeyInRange };
