import "server-only";

import { Client } from "@upstash/qstash";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { menuDays } from "@/lib/db/schema";
import { env, publicEnv } from "@/lib/env";

/**
 * Per-day deadline scheduling via QStash.
 *
 * Each day gets ONE callback scheduled for its exact deadline, rather than a
 * cron sweeping every few minutes. Two advantages: the day closes on time
 * instead of within a 5-minute window, and there is no polling — which matters
 * because free serverless hosting has nothing awake to poll with.
 *
 * Scheduling is always best-effort. A failure here must never block publishing
 * a menu: the deadline is still enforced on read (the ordering page and the
 * order API both check it), so the worst case is a late admin summary, not a
 * menu nobody can order from.
 */

let client: Client | null = null;

function getClient(): Client | null {
  if (!env.QSTASH_TOKEN) return null;
  if (!client) {
    client = new Client({ token: env.QSTASH_TOKEN });
  }
  return client;
}

export function isSchedulerConfigured(): boolean {
  return Boolean(env.QSTASH_TOKEN && publicEnv.NEXT_PUBLIC_APP_URL);
}

/** QStash cannot reach localhost, so scheduling is skipped in local dev. */
function isReachable(appUrl: string): boolean {
  return !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(appUrl);
}

/**
 * Schedule the close callback for a day, replacing any existing one.
 *
 * Returns the message id (also persisted) or null when scheduling was skipped
 * or failed.
 */
export async function scheduleDeadlineClose(input: {
  menuDayId: string;
  dateKey: string;
  deadlineAt: Date;
}): Promise<string | null> {
  const qstash = getClient();
  const appUrl = publicEnv.NEXT_PUBLIC_APP_URL;

  if (!qstash || !appUrl) return null;
  if (!isReachable(appUrl)) {
    console.info("[scheduler] skipping — %s is not reachable from QStash", appUrl);
    return null;
  }

  // Replacing an existing schedule: cancel first so an edited deadline can't
  // leave the original callback in flight and close the day at the old time.
  await cancelDeadlineClose(input.menuDayId);

  // Already past (or within a second of it) — nothing to schedule. The sweep
  // path and read-time checks cover this.
  const secondsUntil = Math.floor((input.deadlineAt.getTime() - Date.now()) / 1000);
  if (secondsUntil <= 0) return null;

  // Free tier caps delay at 7 days. Lunch deadlines are same-day, so this is a
  // guard against a mis-entered date rather than an expected case.
  const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;
  if (secondsUntil > SEVEN_DAYS_SECONDS) {
    console.warn("[scheduler] deadline is beyond QStash's 7-day limit; not scheduling");
    return null;
  }

  try {
    const result = await qstash.publishJSON({
      url: `${appUrl}/api/qstash/close-day`,
      body: { menuDayId: input.menuDayId, dateKey: input.dateKey },
      // Unix SECONDS. Absolute time rather than a relative delay, so the close
      // isn't skewed by however long publishing took.
      notBefore: Math.floor(input.deadlineAt.getTime() / 1000),
      // Set explicitly — the SDK default is not guaranteed by plan.
      retries: 3,
    });

    await db
      .update(menuDays)
      .set({ deadlineJobId: result.messageId })
      .where(eq(menuDays.id, input.menuDayId));

    return result.messageId;
  } catch (error) {
    // Never rethrow: publishing a menu must succeed regardless.
    console.error("[scheduler] failed to schedule deadline close", error);
    return null;
  }
}

/**
 * Cancel a day's pending close callback.
 *
 * Best-effort by design. A message already delivered is purged by QStash and
 * returns 404, and one already in flight may be too late to stop — which is
 * why the callback itself re-checks state rather than trusting cancellation.
 */
export async function cancelDeadlineClose(menuDayId: string): Promise<void> {
  const qstash = getClient();
  if (!qstash) return;

  const [day] = await db
    .select({ jobId: menuDays.deadlineJobId })
    .from(menuDays)
    .where(eq(menuDays.id, menuDayId))
    .limit(1);

  if (!day?.jobId) return;

  try {
    await qstash.messages.cancel(day.jobId);
  } catch (error) {
    // 404 means it already fired or was already cancelled — expected, not an
    // error worth surfacing.
    const status = (error as { status?: number }).status;
    if (status !== 404) {
      console.error("[scheduler] failed to cancel deadline close", error);
    }
  }

  await db
    .update(menuDays)
    .set({ deadlineJobId: null })
    .where(eq(menuDays.id, menuDayId));
}
