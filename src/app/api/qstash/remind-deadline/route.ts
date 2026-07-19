import { NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { and, eq, isNull, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { menuDays, orders, people } from "@/lib/db/schema";
import { sendPushToPeople } from "@/lib/push";
import { env } from "@/lib/env";
import { formatTime } from "@/lib/time";

/**
 * Nudges people who haven't ordered, shortly before the deadline.
 *
 * Deliberately targeted: only approved members with no order for the day. The
 * point is to catch the people who forgot, so pinging someone who already
 * ordered would be pure noise and would train the group to ignore the app.
 */

const receiver =
  env.QSTASH_CURRENT_SIGNING_KEY && env.QSTASH_NEXT_SIGNING_KEY
    ? new Receiver({
        currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
        nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
      })
    : null;

export async function POST(request: Request) {
  if (!receiver) {
    return NextResponse.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Not configured." } },
      { status: 403 },
    );
  }

  // Raw body — re-serialised JSON would not match the signature.
  const rawBody = await request.text();
  const signature = request.headers.get("upstash-signature");

  if (!signature) {
    return NextResponse.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Missing signature." } },
      { status: 403 },
    );
  }

  try {
    const isValid = await receiver.verify({ signature, body: rawBody });
    if (!isValid) throw new Error("invalid");
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Invalid signature." } },
      { status: 403 },
    );
  }

  let menuDayId: string;
  try {
    ({ menuDayId } = JSON.parse(rawBody) as { menuDayId: string });
    if (!menuDayId) throw new Error("missing menuDayId");
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: "Bad payload." } },
      { status: 400 },
    );
  }

  try {
    const [day] = await db
      .select({
        id: menuDays.id,
        dateKey: menuDays.dateKey,
        status: menuDays.status,
        deadlineAt: menuDays.deadlineAt,
      })
      .from(menuDays)
      .where(eq(menuDays.id, menuDayId))
      .limit(1);

    // Closed early, or the day vanished — nothing to remind about. 200 so
    // QStash doesn't retry a message that can never succeed.
    if (!day || day.status !== "published" || !day.deadlineAt) {
      return NextResponse.json({ ok: true, data: { skipped: true, reason: "not open" } });
    }

    // Everyone approved who has no order for this day. A cancelled order still
    // counts as "has ordered" — they made a decision, and an approved
    // cancellation is not the same as forgetting.
    const alreadyOrdered = db
      .select({ personId: orders.personId })
      .from(orders)
      .where(eq(orders.menuDayId, day.id));

    const toRemind = await db
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.accountStatus, "approved"),
          isNull(people.mergedIntoId),
          notInArray(people.id, alreadyOrdered),
        ),
      );

    if (toRemind.length === 0) {
      return NextResponse.json({ ok: true, data: { reminded: 0, reason: "everyone ordered" } });
    }

    await sendPushToPeople(
      toRemind.map((person) => person.id),
      {
        title: "Ordering closes soon",
        body: `You haven't ordered yet — closes at ${formatTime(day.deadlineAt)}.`,
        url: `/d/${String(day.dateKey)}`,
        tag: `remind-${String(day.dateKey)}`,
      },
    );

    await db
      .update(menuDays)
      .set({ reminderJobId: null })
      .where(eq(menuDays.id, day.id));

    return NextResponse.json({ ok: true, data: { reminded: toRemind.length } });
  } catch (error) {
    console.error("[qstash] remind-deadline failed", error);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL", message: "Reminder failed." } },
      { status: 500 },
    );
  }
}
