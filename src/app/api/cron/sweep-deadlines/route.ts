import { NextResponse } from "next/server";
import { sweepExpiredDeadlines } from "@/lib/services/day-service";
import { pruneExpiredSessions } from "@/lib/auth/session";
import { env } from "@/lib/env";

/**
 * Deadline sweeper.
 *
 * A scheduler cannot fire at an arbitrary per-record timestamp, so this runs
 * every few minutes and closes any day whose deadline has passed. It is
 * idempotent — lockDay only transitions `published` rows — so overlapping runs
 * cannot double-fire notifications.
 *
 * Deliberately host-agnostic: it is just an authenticated HTTPS GET, so any
 * scheduler can drive it (Render cron job, GitHub Actions, cron-job.org, or a
 * plain curl). See DEPLOY.md.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://<host>/api/cron/sweep-deadlines
 */
export async function GET(request: Request) {
  // The endpoint is a public URL, so without a guard anyone could hammer it and
  // close polls early. Two accepted callers:
  //   1. A scheduler presenting the shared secret (works on any host).
  //   2. Vercel's own cron, which injects this header — kept so the app still
  //      works unchanged if it is ever deployed there.
  const authHeader = request.headers.get("authorization");
  const isVercelCron = request.headers.get("x-vercel-cron") !== null;
  const hasSecret = Boolean(env.CRON_SECRET) && authHeader === `Bearer ${env.CRON_SECRET}`;

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
