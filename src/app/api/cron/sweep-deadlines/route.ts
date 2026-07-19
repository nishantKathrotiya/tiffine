import { NextResponse } from "next/server";
import { sweepExpiredDeadlines } from "@/lib/services/day-service";
import { pruneExpiredSessions } from "@/lib/auth/session";
import { env } from "@/lib/env";

/**
 * Deadline sweeper.
 *
 * Vercel Cron cannot fire at an arbitrary per-record timestamp, so this runs
 * every few minutes and closes any day whose deadline has passed. It is
 * idempotent — lockDay only transitions `published` rows — so overlapping runs
 * cannot double-fire notifications.
 *
 * Schedule in vercel.json:
 *   { "path": "/api/cron/sweep-deadlines", "schedule": "*\/5 * * * *" }
 */
export async function GET(request: Request) {
  // Vercel Cron sends this header; a shared secret covers manual/local runs.
  // Without a guard, anyone could hammer the endpoint and close days early.
  const authHeader = request.headers.get("authorization");
  const isVercelCron = request.headers.get("x-vercel-cron") !== null;
  const hasSecret = env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`;

  if (!isVercelCron && !hasSecret) {
    return NextResponse.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Not authorised." } },
      { status: 403 },
    );
  }

  try {
    const swept = await sweepExpiredDeadlines();
    const prunedSessions = await pruneExpiredSessions();

    if (swept.locked.length > 0) {
      console.info("[cron] closed %d day(s):", swept.locked.length, swept.locked);
    }

    return NextResponse.json({
      ok: true,
      data: {
        lockedDays: swept.locked,
        lockedCount: swept.locked.length,
        prunedSessions,
      },
    });
  } catch (error) {
    // Log the detail server-side; the scheduler only needs the status.
    console.error("[cron] sweep-deadlines failed:", error);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL", message: "Sweep failed." } },
      { status: 500 },
    );
  }
}
