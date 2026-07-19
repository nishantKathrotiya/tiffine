import "server-only";

import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, menuDays, menuItems, orderRounds, orders } from "@/lib/db/schema";
import { assertIsAdmin, type Viewer } from "@/lib/auth/permissions";
import { AppError, errors } from "@/lib/api/errors";
import { getDateKey, formatTime, isPast } from "@/lib/time";
import { sendPushToApproved } from "@/lib/push";
import { scheduleDeadlineClose } from "@/lib/scheduler";
import { publicEnv } from "@/lib/env";

/**
 * Menu creation and publishing.
 *
 * Items are entered by hand — there is no parsing step. A price is therefore
 * something Deep typed and can see, rather than something a parser guessed and
 * he has to catch before it reaches 15 people's bills.
 */

/**
 * Collapse an item name for cross-day grouping: "Roti", "roti", and
 * "Chapati / Roti" should be one line on a statement, not three.
 */
export function normalizeItemName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\/\-_]+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type MenuItemInput = {
  name: string;
  unitPricePaise: number;
};

/** The day Deep is currently working on, with its items. */
export async function getMenuDay(dateKey: string) {
  const [day] = await db.select().from(menuDays).where(eq(menuDays.dateKey, dateKey)).limit(1);
  if (!day) return null;

  const [round] = await db
    .select()
    .from(orderRounds)
    .where(eq(orderRounds.menuDayId, day.id))
    .orderBy(desc(orderRounds.roundNumber))
    .limit(1);

  const items = round
    ? await db
        .select()
        .from(menuItems)
        .where(eq(menuItems.orderRoundId, round.id))
        .orderBy(menuItems.sortOrder)
    : [];

  const [orderStats] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.menuDayId, day.id), eq(orders.status, "active")));

  return { day, round: round ?? null, items, orderCount: orderStats?.count ?? 0 };
}

/**
 * Items used recently, most-frequent first.
 *
 * This is what keeps daily setup near 30 seconds: the provider's menu repeats
 * heavily, so most days are a few taps rather than retyping names and prices.
 */
export async function getRecentItems(limit = 12) {
  return db
    .select({
      name: sql<string>`(array_agg(${menuItems.name} order by ${menuItems.createdAt} desc))[1]`,
      normalizedName: menuItems.normalizedName,
      unitPricePaise: sql<number>`(array_agg(${menuItems.unitPricePaise} order by ${menuItems.createdAt} desc))[1]::bigint`,
      timesUsed: sql<number>`count(*)::int`,
    })
    .from(menuItems)
    .groupBy(menuItems.normalizedName)
    .orderBy(desc(sql`count(*)`), desc(sql`max(${menuItems.createdAt})`))
    .limit(limit);
}

/**
 * Create or replace today's draft menu.
 *
 * Editing a published day replaces its round-1 items wholesale, which is safe
 * only while nobody has ordered — once orders exist, changing prices underneath
 * them would silently alter what people owe. That case is refused here and
 * handled by a re-poll (Phase 4) instead.
 */
export async function saveMenuDay(
  viewer: Viewer,
  input: { dateKey: string; title: string; deadlineAt: Date; items: MenuItemInput[] },
): Promise<{ menuDayId: string }> {
  assertIsAdmin(viewer);

  if (input.items.length === 0) {
    throw new AppError("VALIDATION_FAILED", "Add at least one item before saving.");
  }

  // Duplicate names would produce two indistinguishable rows in the poll and
  // split the same dish across two statement lines.
  const seen = new Set<string>();
  for (const item of input.items) {
    const key = normalizeItemName(item.name);
    if (seen.has(key)) {
      throw new AppError(
        "VALIDATION_FAILED",
        `"${item.name}" is listed twice. Each item should appear once.`,
      );
    }
    seen.add(key);
  }

  const existing = await db
    .select()
    .from(menuDays)
    .where(eq(menuDays.dateKey, input.dateKey))
    .limit(1);

  let menuDayId: string;

  if (existing[0]) {
    const day = existing[0];

    if (day.status === "locked" || day.status === "sent_to_provider" || day.status === "settled") {
      throw errors.dayLocked(day.status === "sent_to_provider");
    }

    /**
     * Once published, the menu is frozen.
     *
     * The link is already in the group chat, so people may be looking at it
     * right now. Editing an item or a price after that means someone votes
     * against a menu that no longer exists — and if they'd already ordered,
     * their bill would change underneath them.
     *
     * Waiting for the first order isn't sufficient protection: the window
     * between publishing and the first vote is exactly when the link is being
     * read. A genuine change after publishing goes through a new round, which
     * re-asks the affected people and can't double-bill.
     */
    if (day.status === "published") {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(eq(orders.menuDayId, day.id));

      throw new AppError(
        "CONFLICT",
        count > 0
          ? `This menu is already out for voting and ${count} ${count === 1 ? "person has" : "people have"} ordered. ` +
              `Open a new round to change it, so nobody's order is re-priced.`
          : "This menu is already out for voting, so it can't be edited. " +
              "Open a new round if something needs to change.",
      );
    }

    await db
      .update(menuDays)
      .set({ title: input.title, deadlineAt: input.deadlineAt })
      .where(eq(menuDays.id, day.id));

    menuDayId = day.id;
  } else {
    const [created] = await db
      .insert(menuDays)
      .values({
        dateKey: input.dateKey,
        title: input.title,
        deadlineAt: input.deadlineAt,
        status: "draft",
        createdBy: viewer.id,
      })
      .returning({ id: menuDays.id });

    menuDayId = created.id;
  }

  // Round 1 holds the initial menu. Replaced wholesale here; later rounds are
  // additive and never touch this one.
  const [existingRound] = await db
    .select()
    .from(orderRounds)
    .where(and(eq(orderRounds.menuDayId, menuDayId), eq(orderRounds.roundNumber, 1)))
    .limit(1);

  let roundId: string;

  if (existingRound) {
    roundId = existingRound.id;
    await db
      .update(orderRounds)
      .set({ deadlineAt: input.deadlineAt })
      .where(eq(orderRounds.id, roundId));
    await db.delete(menuItems).where(eq(menuItems.orderRoundId, roundId));
  } else {
    const [round] = await db
      .insert(orderRounds)
      .values({
        menuDayId,
        roundNumber: 1,
        deadlineAt: input.deadlineAt,
        createdBy: viewer.id,
      })
      .returning({ id: orderRounds.id });
    roundId = round.id;
  }

  await db.insert(menuItems).values(
    input.items.map((item, index) => ({
      menuDayId,
      orderRoundId: roundId,
      name: item.name.trim(),
      normalizedName: normalizeItemName(item.name),
      unitPricePaise: item.unitPricePaise,
      sortOrder: index,
    })),
  );

  return { menuDayId };
}

/**
 * Publish a draft so the group can order.
 *
 * Publishing is what makes the day visible and orderable, so the deadline must
 * still be in the future — publishing into the past would open a menu that is
 * already closed.
 */
export async function publishMenuDay(viewer: Viewer, dateKey: string): Promise<void> {
  assertIsAdmin(viewer);

  const [day] = await db.select().from(menuDays).where(eq(menuDays.dateKey, dateKey)).limit(1);
  if (!day) throw errors.notFound("That menu");

  if (day.status !== "draft") {
    throw new AppError("CONFLICT", "This menu has already been published.");
  }
  if (!day.deadlineAt) {
    throw new AppError("VALIDATION_FAILED", "Set an ordering deadline before publishing.");
  }
  if (isPast(day.deadlineAt)) {
    throw new AppError(
      "VALIDATION_FAILED",
      "That deadline has already passed. Pick a later time before publishing.",
      { fields: { deadlineAt: "Deadline must be in the future." } },
    );
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(menuItems)
    .where(eq(menuItems.menuDayId, day.id));

  if (count === 0) {
    throw new AppError("VALIDATION_FAILED", "Add at least one item before publishing.");
  }

  await db.update(menuDays).set({ status: "published" }).where(eq(menuDays.id, day.id));

  await db.insert(auditLog).values({
    actorId: viewer.id,
    action: "menu.publish",
    entityType: "menu_day",
    entityId: day.id,
    detail: { dateKey, title: day.title, itemCount: count },
  });

  // Schedule the automatic close for this day's exact deadline. Best-effort:
  // the deadline is still enforced on read if scheduling fails.
  void scheduleDeadlineClose({
    menuDayId: day.id,
    dateKey,
    deadlineAt: day.deadlineAt,
  }).catch((error) => console.error("[scheduler] publish schedule failed", error));

  // Notifications are a nudge only — publishing must succeed even if every
  // push fails, so this never rethrows.
  void sendPushToApproved({
    title: day.title || "Today's menu is up",
    body: `Order by ${formatTime(day.deadlineAt)}. Tap to pick your items.`,
    url: `${publicEnv.NEXT_PUBLIC_APP_URL}/d/${dateKey}`,
    tag: `menu-${dateKey}`,
  }).catch((error) => console.error("[push] menu.publish notify failed", error));
}

/** Menu days for the admin list, most recent first. */
export async function listMenuDays(viewer: Viewer, limit = 30) {
  assertIsAdmin(viewer);

  return db
    .select({
      id: menuDays.id,
      dateKey: menuDays.dateKey,
      title: menuDays.title,
      status: menuDays.status,
      deadlineAt: menuDays.deadlineAt,
      itemCount: sql<number>`(select count(*)::int from ${menuItems} where ${menuItems.menuDayId} = ${menuDays.id})`,
      orderCount: sql<number>`(select count(*)::int from ${orders} where ${orders.menuDayId} = ${menuDays.id} and ${orders.status} = 'active')`,
    })
    .from(menuDays)
    .orderBy(desc(menuDays.dateKey))
    .limit(limit);
}

/** Today's published menu for the ordering page, or null if none. */
export async function getTodaysPublishedMenu(dateKey = getDateKey()) {
  const [day] = await db
    .select()
    .from(menuDays)
    .where(and(eq(menuDays.dateKey, dateKey), ne(menuDays.status, "draft")))
    .limit(1);

  if (!day) return null;

  const [round] = await db
    .select()
    .from(orderRounds)
    .where(and(eq(orderRounds.menuDayId, day.id), isNull(orderRounds.closedAt)))
    .orderBy(desc(orderRounds.roundNumber))
    .limit(1);

  if (!round) return null;

  const items = await db
    .select()
    .from(menuItems)
    .where(and(eq(menuItems.orderRoundId, round.id), eq(menuItems.isAvailable, true)))
    .orderBy(menuItems.sortOrder);

  return { day, round, items };
}
