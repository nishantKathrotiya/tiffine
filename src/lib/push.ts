import "server-only";

import webpush from "web-push";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { people, pushSubscriptions } from "@/lib/db/schema";
import { env, publicEnv } from "@/lib/env";

/**
 * Web Push delivery.
 *
 * Notifications here are a convenience nudge, never the delivery mechanism:
 * Deep still posts the link in WhatsApp, and every deadline summary is visible
 * in the app. Nobody misses lunch because a push failed — which is what makes
 * the PWA approach viable despite iOS's weaker delivery.
 *
 * Two iOS rules are enforced on the sending side:
 *
 *   1. Every push MUST render a visible notification. iOS cancels a
 *      subscription after 3 pushes that don't, so silent/data-only payloads are
 *      never sent (see public/sw.js for the receiving half).
 *   2. A 410/404 response means the subscription is dead. It is deactivated
 *      rather than deleted, so "never subscribed" stays distinguishable from
 *      "expired" when debugging why someone gets nothing.
 */

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;

  const publicKey = publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) return false;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  /** Where tapping the notification lands. */
  url?: string;
  /**
   * Collapse key. A second push with the same tag replaces the first rather
   * than stacking — so a re-poll doesn't bury the original menu notification.
   */
  tag?: string;
};

type SendResult = { sent: number; failed: number; deactivated: number };

/**
 * Send to specific people. Failures never throw: a notification is a nudge,
 * and a dead subscription must not fail the request that triggered it (a
 * published menu still publishes).
 */
export async function sendPushToPeople(
  personIds: string[],
  payload: PushPayload,
): Promise<SendResult> {
  if (personIds.length === 0) return { sent: 0, failed: 0, deactivated: 0 };
  if (!ensureConfigured()) {
    console.warn("[push] VAPID keys not configured; skipping send");
    return { sent: 0, failed: 0, deactivated: 0 };
  }

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(
      and(inArray(pushSubscriptions.personId, personIds), eq(pushSubscriptions.isActive, true)),
    );

  return deliver(subs, payload);
}

/** Send to everyone who can act on it — approved accounts only. */
export async function sendPushToApproved(
  payload: PushPayload,
  options: { excludePersonId?: string } = {},
): Promise<SendResult> {
  if (!ensureConfigured()) return { sent: 0, failed: 0, deactivated: 0 };

  const subs = await db
    .select({
      id: pushSubscriptions.id,
      personId: pushSubscriptions.personId,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .innerJoin(people, eq(people.id, pushSubscriptions.personId))
    .where(
      and(
        eq(pushSubscriptions.isActive, true),
        eq(people.accountStatus, "approved"),
        options.excludePersonId
          ? ne(pushSubscriptions.personId, options.excludePersonId)
          : undefined,
      ),
    );

  return deliver(subs, payload);
}

/** Send to every active admin — used for deadline summaries. */
export async function sendPushToAdmins(payload: PushPayload): Promise<SendResult> {
  if (!ensureConfigured()) return { sent: 0, failed: 0, deactivated: 0 };

  const subs = await db
    .select({
      id: pushSubscriptions.id,
      personId: pushSubscriptions.personId,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .innerJoin(people, eq(people.id, pushSubscriptions.personId))
    .where(
      and(
        eq(pushSubscriptions.isActive, true),
        eq(people.isAdmin, true),
        eq(people.accountStatus, "approved"),
      ),
    );

  return deliver(subs, payload);
}

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

async function deliver(subs: SubscriptionRow[], payload: PushPayload): Promise<SendResult> {
  let sent = 0;
  let failed = 0;
  const dead: string[] = [];

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/",
    tag: payload.tag,
  });

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          // Urgency high: these are time-boxed (a deadline is approaching), so
          // battery-saving delays defeat the purpose.
          { TTL: 3600, urgency: "high" },
        );
        sent++;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;

        // 410 Gone / 404 Not Found: the subscription no longer exists. This is
        // routine on iOS, not an error worth logging loudly.
        if (statusCode === 410 || statusCode === 404) {
          dead.push(sub.id);
        } else {
          failed++;
          console.error("[push] send failed", { statusCode, endpoint: sub.endpoint.slice(0, 40) });
        }
      }
    }),
  );

  if (dead.length > 0) {
    // Deactivated, not deleted — keeps the distinction between "never
    // subscribed" and "expired" when working out why someone gets nothing.
    await db
      .update(pushSubscriptions)
      .set({ isActive: false, lastFailedAt: new Date() })
      .where(inArray(pushSubscriptions.id, dead));
  }

  return { sent, failed, deactivated: dead.length };
}

export async function saveSubscription(
  personId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent?: string,
): Promise<void> {
  // Endpoint is unique. Re-subscribing after an iOS expiry produces the same
  // endpoint, so upsert and reactivate rather than inserting a duplicate.
  await db
    .insert(pushSubscriptions)
    .values({
      personId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent: userAgent?.slice(0, 500),
      isActive: true,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        personId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        isActive: true,
        lastFailedAt: null,
      },
    });
}

/**
 * Deactivate one endpoint.
 *
 * Note the client must NOT call `subscription.unsubscribe()` on sign-out:
 * Safari then refuses to re-subscribe without a fresh user gesture, so the
 * person silently stops receiving anything. Deactivating server-side keeps the
 * browser's subscription intact.
 */
export async function deactivateSubscription(endpoint: string): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ isActive: false })
    .where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function countActiveSubscriptions(personId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.personId, personId), eq(pushSubscriptions.isActive, true)));
  return row?.count ?? 0;
}

export function isPushConfigured(): boolean {
  return Boolean(publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}
