import { NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { menuDays } from "@/lib/db/schema";
import { lockDay } from "@/lib/services/day-service";
import { env } from "@/lib/env";

/**
 * Closes one day when its deadline arrives — the QStash callback.
 *
 * Two properties this handler must have, both because QStash is at-least-once:
 *
 *   1. **Signature verified.** The URL is public, so without verification
 *      anyone could POST a menuDayId and close a poll early.
 *   2. **Idempotent.** Retries and duplicate deliveries are normal. `lockDay`
 *      only transitions `published` days, so a second delivery is a no-op
 *      rather than a second notification.
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
    console.error("[qstash] signing keys not configured; refusing callback");
    return NextResponse.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Not configured." } },
      { status: 403 },
    );
  }

  // The RAW body is what was signed. Reading it as text first is required —
  // JSON.parse then re-stringify changes the bytes and breaks verification.
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
    if (!isValid) {
      return NextResponse.json(
        { ok: false, error: { code: "FORBIDDEN", message: "Invalid signature." } },
        { status: 403 },
      );
    }
  } catch (error) {
    console.error("[qstash] signature verification threw", error);
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
    // Malformed payload: 400, not 500. Retrying won't help, and a 5xx would
    // make QStash retry a message that can never succeed.
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: "Bad payload." } },
      { status: 400 },
    );
  }

  try {
    // actorId null marks this as an automatic close, distinguishing it from an
    // admin closing early in the audit trail.
    const result = await lockDay(menuDayId, null);

    // Clear the job id either way — the message has now been delivered, so
    // there is nothing left to cancel.
    await db
      .update(menuDays)
      .set({ deadlineJobId: null })
      .where(eq(menuDays.id, menuDayId));

    if (result.locked) {
      console.info("[qstash] closed day %s", menuDayId);
    }

    // 200 even when already closed: the day is in the desired state, so a
    // retry would be pointless work.
    return NextResponse.json({
      ok: true,
      data: { menuDayId, closed: result.locked, alreadyClosed: !result.locked },
    });
  } catch (error) {
    // A genuine failure — 500 so QStash retries with backoff.
    console.error("[qstash] close-day failed", error);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL", message: "Close failed." } },
      { status: 500 },
    );
  }
}
