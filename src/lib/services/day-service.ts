import "server-only";

import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLog,
  menuDays,
  menuItems,
  orderLines,
  orderRevisions,
  orderRounds,
  orders,
  people,
} from "@/lib/db/schema";
import { assertIsAdmin, type Viewer } from "@/lib/auth/permissions";
import { AppError, errors } from "@/lib/api/errors";
import { formatPaise, sumPaise, type Paise } from "@/lib/money";
import { formatDayShort, formatTime } from "@/lib/time";
import { sendPushToAdmins, sendPushToPeople } from "@/lib/push";

/**
 * Closing a day, handing counts to the provider, and re-polling.
 *
 * The re-poll is the dangerous operation: the provider comes back after counts
 * were sent ("out of paneer"), people change their choices, and the day must
 * still bill exactly once per person. That is guaranteed by updating the same
 * effective order rather than creating a second one — see order-service.
 */

/**
 * Aggregated counts for the provider.
 *
 * Grouped by normalized name so "Roti" and "roti" collapse into one line —
 * the provider needs a single number per dish, not two near-identical rows.
 */
export async function getProviderSummary(menuDayId: string) {
  const rows = await db
    .select({
      name: sql<string>`min(${orderLines.itemNameSnapshot})`,
      normalizedName: menuItems.normalizedName,
      totalQuantity: sql<number>`sum(${orderLines.quantity})::int`,
      unitPricePaise: sql<number>`max(${orderLines.unitPricePaiseSnapshot})::bigint`,
      lineTotalPaise: sql<number>`sum(${orderLines.quantity} * ${orderLines.unitPricePaiseSnapshot})::bigint`,
    })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(menuItems, eq(menuItems.id, orderLines.menuItemId))
    .where(and(eq(orders.menuDayId, menuDayId), eq(orders.status, "active")))
    .groupBy(menuItems.normalizedName)
    .orderBy(sql`min(${orderLines.itemNameSnapshot})`);

  const items = rows.map((row) => ({
    ...row,
    unitPricePaise: Number(row.unitPricePaise),
    lineTotalPaise: Number(row.lineTotalPaise),
  }));

  const [peopleCount] = await db
    .select({ count: sql<number>`count(distinct ${orders.personId})::int` })
    .from(orders)
    .where(and(eq(orders.menuDayId, menuDayId), eq(orders.status, "active")));

  return {
    items,
    peopleCount: peopleCount?.count ?? 0,
    totalPaise: sumPaise(items.map((item) => item.lineTotalPaise)),
  };
}

/** Per-person breakdown for the day, so Deep can see who ordered what. */
export async function getDayBreakdown(menuDayId: string) {
  const rows = await db
    .select({
      personId: orders.personId,
      name: people.name,
      status: orders.status,
      itemSummary: sql<string>`coalesce((
        select string_agg(${orderLines.itemNameSnapshot} || ' ×' || ${orderLines.quantity}, ', ')
        from ${orderLines} where ${orderLines.orderId} = ${orders.id}
      ), '')`,
      totalPaise: sql<number>`coalesce((
        select sum(${orderLines.quantity} * ${orderLines.unitPricePaiseSnapshot})
        from ${orderLines} where ${orderLines.orderId} = ${orders.id}
      ), 0)::bigint`,
    })
    .from(orders)
    .innerJoin(people, eq(people.id, orders.personId))
    .where(eq(orders.menuDayId, menuDayId))
    .orderBy(people.name);

  return rows.map((row) => ({ ...row, totalPaise: Number(row.totalPaise) }));
}

/** Plain-text block Deep pastes into WhatsApp for the provider. */
export function formatProviderMessage(
  dateKey: string,
  summary: { items: { name: string; totalQuantity: number }[]; peopleCount: number },
): string {
  const lines = summary.items.map((item) => `${item.name} — ${item.totalQuantity}`);
  return [
    `Order for ${formatDayShort(dateKey)}`,
    "",
    ...lines,
    "",
    `Total: ${summary.peopleCount} ${summary.peopleCount === 1 ? "person" : "people"}`,
  ].join("\n");
}

/**
 * Close ordering for a day.
 *
 * Idempotent by status transition: only a `published` day moves to `locked`,
 * so the 5-minute sweeper running twice cannot double-fire notifications or
 * re-stamp `locked_at`.
 */
export async function lockDay(
  menuDayId: string,
  actorId: string | null,
): Promise<{ locked: boolean }> {
  const updated = await db
    .update(menuDays)
    .set({ status: "locked", lockedAt: new Date() })
    .where(and(eq(menuDays.id, menuDayId), eq(menuDays.status, "published")))
    .returning({ id: menuDays.id });

  if (updated.length === 0) return { locked: false };

  // Close the open round too, so a stale page can't submit into it.
  await db
    .update(orderRounds)
    .set({ closedAt: new Date() })
    .where(and(eq(orderRounds.menuDayId, menuDayId), isNull(orderRounds.closedAt)));

  await db.insert(auditLog).values({
    actorId,
    action: "day.lock",
    entityType: "menu_day",
    entityId: menuDayId,
    detail: { automatic: actorId === null },
  });

  // Tell the admins the counts are final and ready to send.
  const summary = await getProviderSummary(menuDayId);
  void sendPushToAdmins({
    title: "Ordering closed",
    body:
      summary.peopleCount === 0
        ? "Nobody ordered today."
        : `${summary.peopleCount} ${summary.peopleCount === 1 ? "person" : "people"} ordered. Counts are ready to send.`,
    url: "/admin/today/summary",
    tag: `locked-${menuDayId}`,
  }).catch((error) => console.error("[push] day.lock notify failed", error));

  return { locked: true };
}

/** Admin-triggered early close. */
export async function lockDayAsAdmin(viewer: Viewer, dateKey: string) {
  assertIsAdmin(viewer);

  const [day] = await db.select().from(menuDays).where(eq(menuDays.dateKey, dateKey)).limit(1);
  if (!day) throw errors.notFound("That day");

  if (day.status !== "published") {
    throw new AppError("CONFLICT", "This day isn't open for ordering.");
  }

  const result = await lockDay(day.id, viewer.id);
  if (!result.locked) throw new AppError("CONFLICT", "This day was already closed.");
}

/**
 * The sweeper: close every day whose deadline has passed.
 *
 * Runs on a schedule because a per-record timestamp can't be cron-scheduled
 * directly. Safe to run repeatedly — lockDay only acts on `published` rows.
 */
export async function sweepExpiredDeadlines(): Promise<{
  locked: { menuDayId: string; dateKey: string }[];
}> {
  const expired = await db
    .select({ id: menuDays.id, dateKey: menuDays.dateKey })
    .from(menuDays)
    .where(and(eq(menuDays.status, "published"), lte(menuDays.deadlineAt, new Date())));

  const locked: { menuDayId: string; dateKey: string }[] = [];

  for (const day of expired) {
    const result = await lockDay(day.id, null);
    if (result.locked) locked.push({ menuDayId: day.id, dateKey: day.dateKey });
  }

  return { locked };
}

/** Mark the day as handed to the provider. */
export async function markSentToProvider(viewer: Viewer, dateKey: string) {
  assertIsAdmin(viewer);

  const [day] = await db.select().from(menuDays).where(eq(menuDays.dateKey, dateKey)).limit(1);
  if (!day) throw errors.notFound("That day");

  if (day.status === "settled") throw errors.alreadySettled();
  if (day.status === "draft" || day.status === "published") {
    throw new AppError("CONFLICT", "Close ordering before sending counts to the provider.");
  }

  await db
    .update(menuDays)
    .set({ status: "sent_to_provider", sentAt: new Date() })
    .where(eq(menuDays.id, day.id));

  await db.insert(auditLog).values({
    actorId: viewer.id,
    action: "day.sent_to_provider",
    entityType: "menu_day",
    entityId: day.id,
    detail: { dateKey },
  });
}

/**
 * Open a new ordering round after the provider reports a shortage.
 *
 * Carries forward the still-available items and any replacements, then reopens
 * the day. Crucially it does NOT touch existing orders: people whose choices
 * are unaffected keep them, and anyone who switches updates their single
 * effective order rather than adding a second one.
 */
export async function openRepoll(
  viewer: Viewer,
  input: {
    dateKey: string;
    reason: string;
    deadlineAt: Date;
    /** Items from the previous round to carry over, by id. */
    keepItemIds: string[];
    /** Brand-new replacement items offered by the provider. */
    newItems: { name: string; unitPricePaise: Paise }[];
  },
): Promise<{ roundNumber: number; affectedPeople: number }> {
  assertIsAdmin(viewer);

  const [day] = await db
    .select()
    .from(menuDays)
    .where(eq(menuDays.dateKey, input.dateKey))
    .limit(1);

  if (!day) throw errors.notFound("That day");
  if (day.status === "settled") throw errors.alreadySettled();
  if (day.status === "draft") {
    throw new AppError("CONFLICT", "Publish the menu before re-polling.");
  }
  if (input.keepItemIds.length === 0 && input.newItems.length === 0) {
    throw new AppError("VALIDATION_FAILED", "A new round needs at least one item.");
  }

  const [previousRound] = await db
    .select()
    .from(orderRounds)
    .where(eq(orderRounds.menuDayId, day.id))
    .orderBy(desc(orderRounds.roundNumber))
    .limit(1);

  if (!previousRound) throw errors.notFound("That day's menu");

  const previousItems = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.orderRoundId, previousRound.id))
    .orderBy(menuItems.sortOrder);

  const keepSet = new Set(input.keepItemIds);
  const withdrawnItems = previousItems.filter((item) => !keepSet.has(item.id));
  const withdrawnIds = withdrawnItems.map((item) => item.id);

  // Who is actually affected — only people holding a withdrawn item need to
  // be asked again. Computed before any mutation so the count is accurate.
  const affected = withdrawnIds.length
    ? await db
        .selectDistinct({ personId: orders.personId })
        .from(orderLines)
        .innerJoin(orders, eq(orders.id, orderLines.orderId))
        .where(
          and(
            eq(orders.menuDayId, day.id),
            eq(orders.status, "active"),
            // inArray, not `= any(...)`: Drizzle binds a JS array correctly
            // here, whereas the raw form passes it as a single parameter.
            inArray(orderLines.menuItemId, withdrawnIds),
          ),
        )
    : [];

  await db.update(orderRounds).set({ closedAt: new Date() }).where(eq(orderRounds.id, previousRound.id));

  const nextRoundNumber = previousRound.roundNumber + 1;

  const [round] = await db
    .insert(orderRounds)
    .values({
      menuDayId: day.id,
      roundNumber: nextRoundNumber,
      reason: input.reason,
      deadlineAt: input.deadlineAt,
      createdBy: viewer.id,
    })
    .returning({ id: orderRounds.id });

  // Carried-over items are new rows on the new round, keeping each round's
  // menu self-contained and auditable.
  const carried = previousItems
    .filter((item) => keepSet.has(item.id))
    .map((item, index) => ({
      menuDayId: day.id,
      orderRoundId: round.id,
      name: item.name,
      normalizedName: item.normalizedName,
      unitPricePaise: item.unitPricePaise,
      sortOrder: index,
    }));

  const added = input.newItems.map((item, index) => ({
    menuDayId: day.id,
    orderRoundId: round.id,
    name: item.name.trim(),
    normalizedName: item.name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim(),
    unitPricePaise: item.unitPricePaise,
    sortOrder: carried.length + index,
  }));

  await db.insert(menuItems).values([...carried, ...added]);

  // Drop only the withdrawn lines. Untouched choices survive, so people who
  // weren't affected don't have to re-order.
  if (withdrawnIds.length > 0) {
    const dayOrderIds = (
      await db.select({ id: orders.id }).from(orders).where(eq(orders.menuDayId, day.id))
    ).map((row) => row.id);

    if (dayOrderIds.length > 0) {
      await db
        .delete(orderLines)
        .where(
          and(
            inArray(orderLines.menuItemId, withdrawnIds),
            inArray(orderLines.orderId, dayOrderIds),
          ),
        );

      // An order left with no lines means that person now has nothing — remove
      // it so they don't show in the provider count as ordering nothing.
      const remaining = await db
        .select({ orderId: orderLines.orderId })
        .from(orderLines)
        .where(inArray(orderLines.orderId, dayOrderIds));

      const stillHasLines = new Set(remaining.map((row) => row.orderId));
      const emptyOrderIds = dayOrderIds.filter((id) => !stillHasLines.has(id));

      if (emptyOrderIds.length > 0) {
        // Revisions reference the order, so clear them before deleting it.
        await db.delete(orderRevisions).where(inArray(orderRevisions.orderId, emptyOrderIds));
        await db.delete(orders).where(inArray(orders.id, emptyOrderIds));
      }
    }
  }

  // Reopen the day so the affected people can choose again.
  await db
    .update(menuDays)
    .set({ status: "published", deadlineAt: input.deadlineAt, lockedAt: null })
    .where(eq(menuDays.id, day.id));

  await db.insert(auditLog).values({
    actorId: viewer.id,
    action: "day.repoll",
    entityType: "menu_day",
    entityId: day.id,
    detail: {
      roundNumber: nextRoundNumber,
      reason: input.reason,
      withdrawn: withdrawnItems.map((item) => item.name),
      added: input.newItems.map((item) => item.name),
      affectedPeople: affected.length,
    },
  });

  if (affected.length > 0) {
    // Only the people whose choice was withdrawn — everyone else keeps their
    // order and shouldn't be pinged.
    void sendPushToPeople(
      affected.map((row) => row.personId),
      {
        title: "Please pick again",
        body: `${input.reason}. Choose a replacement by ${formatTime(input.deadlineAt)}.`,
        url: `/d/${input.dateKey}`,
        tag: `repoll-${input.dateKey}`,
      },
    ).catch((error) => console.error("[push] repoll notify failed", error));
  }

  return { roundNumber: nextRoundNumber, affectedPeople: affected.length };
}

/** Copy-ready WhatsApp text plus the summary, for the handoff screen. */
export async function getProviderHandoff(viewer: Viewer, dateKey: string) {
  assertIsAdmin(viewer);

  const [day] = await db.select().from(menuDays).where(eq(menuDays.dateKey, dateKey)).limit(1);
  if (!day) throw errors.notFound("That day");

  const summary = await getProviderSummary(day.id);
  const breakdown = await getDayBreakdown(day.id);

  return {
    day,
    summary,
    breakdown,
    message: formatProviderMessage(dateKey, summary),
    totalLabel: formatPaise(summary.totalPaise),
    deadlineLabel: day.deadlineAt ? formatTime(day.deadlineAt) : null,
  };
}
