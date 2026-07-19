import "server-only";

import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  menuDays,
  menuItems,
  orderLines,
  orderRevisions,
  orderRounds,
  orders,
} from "@/lib/db/schema";
import { assertCanPlaceOrders, type Viewer } from "@/lib/auth/permissions";
import { AppError, errors } from "@/lib/api/errors";
import { multiplyPaise, sumPaise, type Paise } from "@/lib/money";
import { formatTime, getDateKey, isPast } from "@/lib/time";

/**
 * Placing and editing orders.
 *
 * Two rules are enforced here on every write, because the whole settlement
 * depends on them:
 *
 *   1. A person holds exactly ONE order per day. Re-polls update that order in
 *      place; they never create a second one. The database enforces this too.
 *   2. Prices are snapshotted onto the line at write time, so a later menu
 *      price change cannot retroactively alter what someone owes.
 */

export type OrderLineInput = { menuItemId: string; quantity: number };

export type OrderView = {
  orderId: string;
  status: "active" | "cancelled";
  lines: { menuItemId: string; name: string; quantity: number; unitPricePaise: Paise }[];
  totalPaise: Paise;
};

/** Compute a line total from snapshotted prices — never from live menu prices. */
export function computeOrderTotal(
  lines: { quantity: number; unitPricePaise: Paise }[],
): Paise {
  return sumPaise(lines.map((line) => multiplyPaise(line.unitPricePaise, line.quantity)));
}

/** The day, its open round, available items, and this person's current order. */
export async function getOrderingContext(viewer: Viewer, dateKey: string) {
  const [day] = await db.select().from(menuDays).where(eq(menuDays.dateKey, dateKey)).limit(1);
  if (!day || day.status === "draft") return null;

  const [round] = await db
    .select()
    .from(orderRounds)
    .where(eq(orderRounds.menuDayId, day.id))
    .orderBy(desc(orderRounds.roundNumber))
    .limit(1);

  if (!round) return null;

  const items = await db
    .select()
    .from(menuItems)
    .where(and(eq(menuItems.orderRoundId, round.id), eq(menuItems.isAvailable, true)))
    .orderBy(menuItems.sortOrder);

  const existing = await getPersonOrder(viewer.id, day.id);

  // Ordering is closed once the deadline passes or the day is locked, whichever
  // comes first — the sweeper may not have run yet when someone loads the page.
  const deadlinePassed = isPast(round.deadlineAt);
  const isOpen = day.status === "published" && !deadlinePassed;

  return { day, round, items, existing, isOpen, deadlinePassed };
}

/** A person's effective order for a day, with snapshotted prices. */
export async function getPersonOrder(
  personId: string,
  menuDayId: string,
): Promise<OrderView | null> {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.menuDayId, menuDayId), eq(orders.personId, personId)))
    .limit(1);

  if (!order) return null;

  const lines = await db
    .select({
      menuItemId: orderLines.menuItemId,
      name: orderLines.itemNameSnapshot,
      quantity: orderLines.quantity,
      unitPricePaise: orderLines.unitPricePaiseSnapshot,
    })
    .from(orderLines)
    .where(eq(orderLines.orderId, order.id));

  const normalized = lines.map((line) => ({
    ...line,
    unitPricePaise: Number(line.unitPricePaise),
  }));

  return {
    orderId: order.id,
    status: order.status,
    lines: normalized,
    totalPaise: computeOrderTotal(normalized),
  };
}

/**
 * Create or replace a person's order for a day.
 *
 * Always an upsert against the single (day, person) row. Submitting an empty
 * line list clears the order, which is how someone opts out before the
 * deadline without needing a cancellation request.
 */
export async function placeOrder(
  viewer: Viewer,
  input: { dateKey: string; lines: OrderLineInput[] },
): Promise<{ orderId: string | null; totalPaise: Paise }> {
  // Pending, inactive, and rejected accounts are refused here — the page may
  // render read-only for them, but this endpoint is directly reachable.
  assertCanPlaceOrders(viewer);

  const [day] = await db
    .select()
    .from(menuDays)
    .where(eq(menuDays.dateKey, input.dateKey))
    .limit(1);

  if (!day) throw errors.notFound("That day's menu");
  if (day.status === "draft") throw errors.notFound("That day's menu");
  if (day.status !== "published") throw errors.dayLocked(day.status === "sent_to_provider");

  const [round] = await db
    .select()
    .from(orderRounds)
    .where(eq(orderRounds.menuDayId, day.id))
    .orderBy(desc(orderRounds.roundNumber))
    .limit(1);

  if (!round) throw errors.notFound("That day's menu");
  if (round.closedAt) throw errors.roundClosed();
  if (isPast(round.deadlineAt)) {
    throw errors.deadlinePassed(formatTime(round.deadlineAt));
  }

  // Validate every referenced item belongs to THIS round and is available.
  // Without this, a stale page could submit an item withdrawn in a re-poll.
  const requestedIds = input.lines.map((line) => line.menuItemId);
  const validItems = requestedIds.length
    ? await db
        .select()
        .from(menuItems)
        .where(and(eq(menuItems.orderRoundId, round.id), inArray(menuItems.id, requestedIds)))
    : [];

  const itemsById = new Map(validItems.map((item) => [item.id, item]));

  for (const line of input.lines) {
    const item = itemsById.get(line.menuItemId);
    if (!item) {
      throw new AppError(
        "ITEM_UNAVAILABLE",
        "One of those items isn't on today's menu any more. Refresh and try again.",
      );
    }
    if (!item.isAvailable) throw errors.itemUnavailable(item.name);
  }

  const [existingOrder] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.menuDayId, day.id), eq(orders.personId, viewer.id)))
    .limit(1);

  // Preserve the prior state before overwriting, so a re-poll switch is
  // auditable without the superseded lines ever reaching a settlement.
  if (existingOrder) {
    const previous = await getPersonOrder(viewer.id, day.id);
    if (previous && previous.lines.length > 0) {
      await db.insert(orderRevisions).values({
        orderId: existingOrder.id,
        orderRoundId: existingOrder.currentRoundId,
        lines: previous.lines,
        totalPaise: previous.totalPaise,
        changedBy: viewer.id,
      });
    }
  }

  // An empty submission means "I'm not eating today" — clear rather than keep
  // a zero-line order that would show as ordered in the provider count.
  if (input.lines.length === 0) {
    if (existingOrder) {
      await db.delete(orderLines).where(eq(orderLines.orderId, existingOrder.id));
      await db.delete(orders).where(eq(orders.id, existingOrder.id));
    }
    return { orderId: null, totalPaise: 0 };
  }

  let orderId: string;

  if (existingOrder) {
    orderId = existingOrder.id;
    await db
      .update(orders)
      .set({ currentRoundId: round.id, status: "active", cancelledAt: null })
      .where(eq(orders.id, orderId));
    await db.delete(orderLines).where(eq(orderLines.orderId, orderId));
  } else {
    // The unique (menu_day_id, person_id) index makes a duplicate impossible
    // even under a double-submit race; the insert simply fails.
    const [created] = await db
      .insert(orders)
      .values({
        menuDayId: day.id,
        personId: viewer.id,
        currentRoundId: round.id,
        status: "active",
      })
      .returning({ id: orders.id });
    orderId = created.id;
  }

  const linesToInsert = input.lines.map((line) => {
    const item = itemsById.get(line.menuItemId)!;
    return {
      orderId,
      menuItemId: item.id,
      quantity: line.quantity,
      // Frozen here. Settlement reads this column, never menu_items.
      unitPricePaiseSnapshot: Number(item.unitPricePaise),
      itemNameSnapshot: item.name,
    };
  });

  await db.insert(orderLines).values(linesToInsert);

  return {
    orderId,
    totalPaise: computeOrderTotal(
      linesToInsert.map((line) => ({
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaiseSnapshot,
      })),
    ),
  };
}

/**
 * A person's order history, newest first.
 *
 * Backs both `/me` (no range — recent activity) and the admin per-person view
 * (range-filtered). One query rather than two so the totals a member sees can
 * never drift from the ones an admin sees.
 */
export async function getOrderHistory(
  personId: string,
  options: { limit?: number; fromDateKey?: string; toDateKey?: string } = {},
) {
  const { limit = 60, fromDateKey, toDateKey } = options;

  const rows = await db
    .select({
      orderId: orders.id,
      status: orders.status,
      dateKey: menuDays.dateKey,
      title: menuDays.title,
      dayStatus: menuDays.status,
      totalPaise: sql<number>`coalesce((
        select sum(${orderLines.quantity} * ${orderLines.unitPricePaiseSnapshot})
        from ${orderLines} where ${orderLines.orderId} = ${orders.id}
      ), 0)::bigint`,
      itemSummary: sql<string>`coalesce((
        select string_agg(${orderLines.itemNameSnapshot} || ' ×' || ${orderLines.quantity}, ', ')
        from ${orderLines} where ${orderLines.orderId} = ${orders.id}
      ), '')`,
    })
    .from(orders)
    .innerJoin(menuDays, eq(menuDays.id, orders.menuDayId))
    .where(
      and(
        eq(orders.personId, personId),
        fromDateKey ? gte(menuDays.dateKey, fromDateKey) : undefined,
        toDateKey ? lte(menuDays.dateKey, toDateKey) : undefined,
      ),
    )
    .orderBy(desc(menuDays.dateKey))
    .limit(limit);

  return rows.map((row) => ({ ...row, totalPaise: Number(row.totalPaise) }));
}

/**
 * Running total for a person over a date range.
 *
 * Cancelled orders are excluded: an approved cancellation means no tiffin and
 * no charge, so it must not appear in what someone expects to pay.
 */
export async function getPersonRunningTotal(
  personId: string,
  fromDateKey: string,
  toDateKey: string = getDateKey(),
): Promise<{ totalPaise: Paise; dayCount: number }> {
  const [row] = await db
    .select({
      totalPaise: sql<number>`coalesce(sum(${orderLines.quantity} * ${orderLines.unitPricePaiseSnapshot}), 0)::bigint`,
      dayCount: sql<number>`count(distinct ${orders.menuDayId})::int`,
    })
    .from(orders)
    .innerJoin(menuDays, eq(menuDays.id, orders.menuDayId))
    .innerJoin(orderLines, eq(orderLines.orderId, orders.id))
    .where(
      and(
        eq(orders.personId, personId),
        eq(orders.status, "active"),
        gte(menuDays.dateKey, fromDateKey),
        lte(menuDays.dateKey, toDateKey),
      ),
    );

  return { totalPaise: Number(row?.totalPaise ?? 0), dayCount: row?.dayCount ?? 0 };
}
