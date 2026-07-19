/**
 * Tiffine service worker.
 *
 * Deliberately minimal: no offline caching. Order state must always be read
 * from the server — a cached menu or a stale deadline would let someone act on
 * information that is no longer true, and the whole point of this app is that
 * the counts are correct.
 */

const APP_NAME = "Tiffine";

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every tab to close, so a
  // fixed handler ships to users on their next visit.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Push handler.
 *
 * TWO RULES, both non-negotiable on iOS:
 *
 *  1. Everything is wrapped in event.waitUntil(). Without it Safari sees the
 *     event terminate before showNotification() resolves.
 *  2. A visible notification is shown for EVERY push, including malformed
 *     ones. iOS cancels the subscription outright after 3 pushes that don't
 *     render — and Chrome papers over this by showing a default notification,
 *     so the bug ships undetected and breaks only iOS users.
 *
 * That is why the catch block still calls showNotification instead of
 * returning early.
 */
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload = {};

      try {
        payload = event.data ? event.data.json() : {};
      } catch {
        // Unparseable payload: still show something rather than silently
        // burning one of the three strikes.
        payload = { title: APP_NAME, body: "You have a new update." };
      }

      const title = payload.title || APP_NAME;
      const options = {
        body: payload.body || "",
        icon: "/icon-192.png",
        badge: "/badge-72.png",
        // Same tag replaces rather than stacks, so a re-poll doesn't bury the
        // original menu notification.
        tag: payload.tag || "tiffine",
        renotify: Boolean(payload.tag),
        data: { url: payload.url || "/" },
        timestamp: Date.now(),
      };

      await self.registration.showNotification(title, options);
    })(),
  );
});

/** Focus an existing tab if one is open; otherwise open the target URL. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of allClients) {
        const clientUrl = new URL(client.url);
        const target = new URL(targetUrl, self.location.origin);

        if (clientUrl.origin === target.origin && "focus" in client) {
          await client.focus();
          if (clientUrl.pathname !== target.pathname && "navigate" in client) {
            await client.navigate(target.href);
          }
          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});

/**
 * Re-subscribe when the browser rotates the subscription.
 *
 * Fires without a user gesture, so it is the only chance to recover silently.
 * The new subscription is posted straight to the server.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const applicationServerKey = event.oldSubscription?.options?.applicationServerKey;
        if (!applicationServerKey) return;

        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });

        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        });
      } catch (error) {
        console.error("[sw] re-subscribe failed", error);
      }
    })(),
  );
});
