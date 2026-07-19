import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLog,
  cancellationRequests,
  menuDays,
  orderLines,
  orderRounds,
  orders,
  people,
} from "@/lib/db/schema";
import { assertCanPlaceOrders, assertIsAdmin, type Viewer } from "@/lib/auth/permissions";
import { AppError, errors } from "@/lib/api/errors";
import { formatDayShort, isPast } from "@/lib/time";
import { sendPushToAdmins, sendPushToPeople } from "@/lib/push";

/**
 * Cancellations after the deadline.
 *
 * Before the deadline a person simply clears their own order — no request, no
 * approval. After it, they must ask:
 *
 *   approved → no tiffin delivered, not billed
 *   rejected → tiffin delivered, billed as normal
 *
 * Every decision is audit-logged so a settlement dispute is answerable from
 * the record rather than from memory.
 */

export async function requestCancellation(
  viewer: Viewer,
  input: { dateKey: string; reason?: string },
): Promise<{ requestId: string }> {
  assertCanPlaceOrders(viewer);

  const [day] = await db
    .select()
    .from(menuDays)
    .where(eq(menuDays.dateKey, input.dateKey))
    .limit(1);

  if (!day) throw errors.notFound("That day");
  if (day.status === "settled") {
    throw new AppError(
      "ALREADY_SETTLED",
      "This day has already been billed. Ask an admin if something looks wrong.",
    );
  }

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.menuDayId, day.id), eq(orders.personId, viewer.id)))
    .limit(1);

  if (!order) throw errors.notFound("Your order for that day");
  if (order.status === "cancelled") {
    throw new AppError("CONFLICT", "That order is already cancelled.");
  }

  // Before the deadline there is nothing to approve — the person can just edit
  // or clear the order themselves, which is faster for everyone.
  const [round] = await db
    .select()
    .from(orderRounds)
    .where(eq(orderRounds.menuDayId, day.id))
    .orderBy(desc(orderRounds.roundNumber))
    .limit(1);

  if (round && !isPast(round.deadlineAt) && day.status === "published") {
    throw new AppError(
      "CONFLICT",
      "Ordering is still open — you can change or clear your order directly.",
    );
  }

  const [existing] = await db
    .select()
    .from(cancellationRequests)
    .where(
      and(eq(cancellationRequests.orderId, order.id), eq(cancellationRequests.status, "pending")),
    )
    .limit(1);

  if (existing) {
    throw new AppError(
      "DUPLICATE",
      "You've already asked to cancel this order. An admin will review it shortly.",
    );
  }

  const [created] = await db
    .insert(cancellationRequests)
    .values({
      orderId: order.id,
      personId: viewer.id,
      reason: input.reason?.trim() || null,
    })
    .returning({ id: cancellationRequests.id });

  void sendPushToAdmins({
    title: "Cancellation requested",
    body: `${viewer.name} wants to cancel their order for ${formatDayShort(input.dateKey)}.`,
    url: "/admin/cancellations",
    tag: `cancel-req-${created.id}`,
  }).catch((error) => console.error("[push] cancellation request notify failed", error));

  await db.insert(auditLog).values({
    actorId: viewer.id,
    action: "cancellation.request",
    entityType: "cancellation_request",
    entityId: created.id,
    detail: { dateKey: input.dateKey, reason: input.reason ?? null },
  });

  return { requestId: created.id };
}

/**
 * Approve or reject.
 *
 * Approving flips the order to `cancelled`, which excludes it from settlement
 * totals and from the provider count. Rejecting leaves the order active, so
 * the person is billed — the tiffin is being delivered either way.
 */
export async function decideCancellation(
  viewer: Viewer,
  input: { requestId: string; approve: boolean; note?: string },
): Promise<void> {
  assertIsAdmin(viewer);

  const [request] = await db
    .select({
      id: cancellationRequests.id,
      orderId: cancellationRequests.orderId,
      personId: cancellationRequests.personId,
      status: cancellationRequests.status,
      menuDayId: orders.menuDayId,
      dayStatus: menuDays.status,
      dateKey: menuDays.dateKey,
    })
    .from(cancellationRequests)
    .innerJoin(orders, eq(orders.id, cancellationRequests.orderId))
    .innerJoin(menuDays, eq(menuDays.id, orders.menuDayId))
    .where(eq(cancellationRequests.id, input.requestId))
    .limit(1);

  if (!request) throw errors.notFound("That request");
  if (request.status !== "pending") {
    throw new AppError("CONFLICT", "That request has already been decided.");
  }
  // Once a day is settled the money has been apportioned; reversing it here
  // would silently desync the committed run.
  if (request.dayStatus === "settled") throw errors.alreadySettled();

  await db
    .update(cancellationRequests)
    .set({
      status: input.approve ? "approved" : "rejected",
      decidedBy: viewer.id,
      decidedAt: new Date(),
      decisionNote: input.note?.trim() || null,
    })
    .where(eq(cancellationRequests.id, request.id));

  if (input.approve) {
    await db
      .update(orders)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(orders.id, request.orderId));
  }

  void sendPushToPeople([request.personId], {
    title: input.approve ? "Cancellation approved" : "Cancellation declined",
    body: input.approve
      ? `No tiffin for ${formatDayShort(String(request.dateKey))}, and you won't be billed.`
      : `Your tiffin for ${formatDayShort(String(request.dateKey))} is being delivered, so it stays on your bill.`,
    url: `/d/${String(request.dateKey)}`,
    tag: `cancel-${request.id}`,
  }).catch((error) => console.error("[push] cancellation notify failed", error));

  await db.insert(auditLog).values({
    actorId: viewer.id,
    action: input.approve ? "cancellation.approve" : "cancellation.reject",
    entityType: "cancellation_request",
    entityId: request.id,
    detail: {
      dateKey: request.dateKey,
      personId: request.personId,
      note: input.note ?? null,
    },
  });
}

/** Pending requests for the admin queue, oldest first. */
export async function listPendingCancellations(viewer: Viewer) {
  assertIsAdmin(viewer);

  const rows = await db
    .select({
      id: cancellationRequests.id,
      reason: cancellationRequests.reason,
      createdAt: cancellationRequests.createdAt,
      personName: people.name,
      personEmail: people.email,
      dateKey: menuDays.dateKey,
      dayTitle: menuDays.title,
      dayStatus: menuDays.status,
      orderTotalPaise: sql<number>`coalesce((
        select sum(${orderLines.quantity} * ${orderLines.unitPricePaiseSnapshot})
        from ${orderLines} where ${orderLines.orderId} = ${cancellationRequests.orderId}
      ), 0)::bigint`,
      itemSummary: sql<string>`coalesce((
        select string_agg(${orderLines.itemNameSnapshot} || ' ×' || ${orderLines.quantity}, ', ')
        from ${orderLines} where ${orderLines.orderId} = ${cancellationRequests.orderId}
      ), '')`,
    })
    .from(cancellationRequests)
    .innerJoin(people, eq(people.id, cancellationRequests.personId))
    .innerJoin(orders, eq(orders.id, cancellationRequests.orderId))
    .innerJoin(menuDays, eq(menuDays.id, orders.menuDayId))
    .where(eq(cancellationRequests.status, "pending"))
    .orderBy(cancellationRequests.createdAt);

  return rows.map((row) => ({ ...row, orderTotalPaise: Number(row.orderTotalPaise) }));
}

export async function getPendingCancellationCount(viewer: Viewer): Promise<number> {
  if (!viewer.isAdmin) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cancellationRequests)
    .where(eq(cancellationRequests.status, "pending"));
  return row?.count ?? 0;
}

/** A person's own request for a day, so the UI can show its state. */
export async function getMyCancellationRequest(personId: string, dateKey: string) {
  const [row] = await db
    .select({
      id: cancellationRequests.id,
      status: cancellationRequests.status,
      reason: cancellationRequests.reason,
      decisionNote: cancellationRequests.decisionNote,
      decidedAt: cancellationRequests.decidedAt,
    })
    .from(cancellationRequests)
    .innerJoin(orders, eq(orders.id, cancellationRequests.orderId))
    .innerJoin(menuDays, eq(menuDays.id, orders.menuDayId))
    .where(and(eq(cancellationRequests.personId, personId), eq(menuDays.dateKey, dateKey)))
    .orderBy(desc(cancellationRequests.createdAt))
    .limit(1);

  return row ?? null;
}
