"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, BellOff, Share, SquarePlus } from "lucide-react";
import { apiPost } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

/**
 * Notification opt-in.
 *
 * The iOS path is the one that actually breaks in practice: Safari exposes
 * PushManager only inside a home-screen web app, so a normal tab silently has
 * no way to subscribe. Rather than showing a button that can't work, this
 * detects that case and walks through Add to Home Screen.
 */

type State =
  | "loading"
  | "unsupported"
  | "not-configured"
  | "ios-needs-install"
  | "denied"
  | "subscribed"
  | "unsubscribed";

/**
 * VAPID keys are URL-safe base64; PushManager wants raw bytes.
 *
 * Allocates an explicit ArrayBuffer so the result is a plain
 * `Uint8Array<ArrayBuffer>` — `Uint8Array.from` widens to ArrayBufferLike,
 * which BufferSource does not accept.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);

  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

function isIos(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as a Mac; the touch check disambiguates.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's non-standard flag for home-screen apps.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export function NotificationSettings({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [state, setState] = useState<State>("loading");
  const [isWorking, setIsWorking] = useState(false);
  // Held on screen rather than shown as a toast: the person seeing it often
  // has to relay it to whoever can fix it.
  const [enableError, setEnableError] = useState<string | null>(null);

  useEffect(() => {
    void detectState();
  }, []);

  async function detectState() {
    // Distinguished from "unsupported": the browser is fine, the server just
    // has no VAPID key. Reporting that as a browser limitation sends people
    // chasing the wrong problem — this is a deployment config gap.
    if (!vapidPublicKey) {
      setState("not-configured");
      return;
    }

    const hasServiceWorker = "serviceWorker" in navigator;
    const hasPush = "PushManager" in window;

    // On iOS the API is missing until the app is installed to the home screen,
    // so "unsupported" here usually means "not installed yet".
    if (!hasServiceWorker || !hasPush) {
      setState(isIos() && !isStandalone() ? "ios-needs-install" : "unsupported");
      return;
    }

    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }

    try {
      /**
       * `serviceWorker.ready` never resolves when nothing has been registered
       * yet — it waits forever rather than rejecting, which left this card
       * stuck on "Checking…" for every first-time visitor.
       *
       * `getRegistration()` settles either way, and the race is a backstop for
       * browsers that leave it pending on a hard-refreshed worker.
       */
      const registration = await Promise.race([
        navigator.serviceWorker.getRegistration(),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3000)),
      ]);

      if (!registration) {
        // No worker yet — normal before the first opt-in. Enabling registers it.
        setState("unsubscribed");
        return;
      }

      const existing = await registration.pushManager.getSubscription();
      setState(existing ? "subscribed" : "unsubscribed");
    } catch (error) {
      // Any failure here still means "not subscribed", which is actionable —
      // unlike a spinner that never resolves.
      console.error("[push] subscription check failed", error);
      setState("unsubscribed");
    }
  }

  async function enable() {
    setIsWorking(true);
    setEnableError(null);

    try {
      const registration = await navigator.serviceWorker.register("/sw.js");

      // Deliberately not awaiting `serviceWorker.ready` — it can hang
      // indefinitely, and `register()` already resolves with a registration
      // that pushManager.subscribe() accepts.

      // Must follow a user gesture — this runs from a click handler.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "unsubscribed");
        setEnableError(
          permission === "denied"
            ? "You tapped Don't Allow. Re-enable notifications for this site in your browser settings, then try again."
            : "The permission prompt was dismissed. Tap the button again and choose Allow.",
        );
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        // Required: iOS terminates subscriptions that receive pushes without
        // showing a notification, so silent pushes are never an option.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const result = await apiPost("/api/push/subscribe", {
        subscription: subscription.toJSON(),
      });

      if (!result.ok) {
        setEnableError(result.error.message);
        return;
      }

      setState("subscribed");
      toast.success("Notifications on.");
    } catch (error) {
      console.error("[push] enable failed", error);
      // A generic "try again" is useless here: each of these has a different
      // fix, and the person hitting it is usually not the one who can debug it.
      setEnableError(describeEnableFailure(error));
    } finally {
      setIsWorking(false);
    }
  }

  /**
   * Turn a subscribe failure into something the person can act on.
   *
   * The common causes are all environmental — an unsupported browser, a
   * private window, a stale worker from a previous key — and none of them are
   * distinguishable from the default message.
   */
  function describeEnableFailure(error: unknown): string {
    const name = (error as { name?: string })?.name ?? "";
    const message = (error as { message?: string })?.message ?? String(error);

    if (name === "NotAllowedError") {
      return "Your browser blocked the request. Check that notifications aren't disabled for this site, then try again.";
    }

    if (name === "AbortError" || /push service|registration failed/i.test(message)) {
      // Typical on Android when Play Services is unavailable, and in private
      // windows where the push service is deliberately unreachable.
      return "Your browser couldn't reach its push service. If you're in a private window, try a normal one. On Android, make sure Google Play Services is enabled.";
    }

    if (name === "NotSupportedError") {
      return "This browser doesn't support push notifications. On iPhone use Safari and add Tiffine to your home screen; on Android use Chrome.";
    }

    if (/applicationServerKey|InvalidAccessError|InvalidStateError/i.test(name + message)) {
      // A worker subscribed under a different VAPID key refuses a new one.
      return "There's an old notification setup on this device. Clear this site's data in your browser settings, reload, and try again.";
    }

    return `Couldn't turn notifications on (${name || "unknown error"}). Try reloading, or use a different browser.`;
  }

  async function disable() {
    setIsWorking(true);

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        // Deactivated server-side only. Calling subscription.unsubscribe()
        // here would stop Safari re-subscribing later without a fresh gesture.
        await apiPost("/api/push/unsubscribe", { endpoint: subscription.endpoint });
      }

      setState("unsubscribed");
      toast.success("Notifications off.");
    } catch {
      toast.error("Couldn't turn notifications off.");
    } finally {
      setIsWorking(false);
    }
  }

  async function sendTest() {
    setIsWorking(true);
    const result = await apiPost("/api/push/test", {});
    setIsWorking(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Test sent — it should arrive in a moment.");
  }

  return (
    <Card>
      <CardHeader
        title="Notifications"
        description="A nudge when the menu is published or a deadline is close"
      />
      <CardBody className="space-y-3">
        {state === "loading" && (
          <p className="text-text-muted text-body">Checking…</p>
        )}

        {state === "ios-needs-install" && (
          <div className="space-y-3">
            {/* The single biggest practical failure point on iOS: without this
                step the person silently receives nothing, and nobody finds out
                until they miss a lunch. */}
            <p className="text-text text-body">
              On iPhone, notifications only work once Tiffine is added to your home screen.
            </p>
            <ol className="text-text-muted text-body space-y-2">
              <li className="flex items-start gap-2">
                <span className="bg-primary-subtle text-primary flex size-5 shrink-0 items-center justify-center rounded-full text-caption font-medium">
                  1
                </span>
                <span className="flex items-center gap-1">
                  Tap <Share className="size-4" aria-hidden /> Share in Safari&rsquo;s toolbar
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="bg-primary-subtle text-primary flex size-5 shrink-0 items-center justify-center rounded-full text-caption font-medium">
                  2
                </span>
                <span className="flex items-center gap-1">
                  Choose <SquarePlus className="size-4" aria-hidden /> Add to Home Screen
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="bg-primary-subtle text-primary flex size-5 shrink-0 items-center justify-center rounded-full text-caption font-medium">
                  3
                </span>
                <span>Open Tiffine from the home screen, then come back here</span>
              </li>
            </ol>
          </div>
        )}

        {state === "not-configured" && (
          <div className="border-warning-border bg-warning-subtle rounded-md border px-3 py-2.5">
            <p className="text-warning text-body font-medium">Not set up on the server</p>
            <p className="text-warning text-caption mt-1 opacity-90">
              NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing from this deployment. Add it in the
              hosting dashboard and redeploy — public env vars are baked in at build time, so
              adding one without redeploying has no effect.
            </p>
          </div>
        )}

        {state === "unsupported" && (
          <p className="text-text-muted text-body">
            This browser doesn&rsquo;t support notifications. You&rsquo;ll still see everything in
            the app, and Deep posts the link in the group chat.
          </p>
        )}

        {state === "denied" && (
          <p className="text-text-muted text-body">
            Notifications are blocked for this site. Allow them in your browser settings, then
            reload this page.
          </p>
        )}

        {state === "unsubscribed" && (
          <>
            {enableError && (
              <div
                role="alert"
                className="border-danger-border bg-danger-subtle rounded-md border px-3 py-2.5"
              >
                <p className="text-danger text-body">{enableError}</p>
              </div>
            )}
            <p className="text-text-muted text-body">
              Optional — the menu link still goes to the group chat either way.
            </p>
            <Button onClick={enable} isLoading={isWorking} loadingText="Turning on…" fullWidth>
              <Bell className="size-4" aria-hidden />
              Turn on notifications
            </Button>
          </>
        )}

        {state === "subscribed" && (
          <>
            <p className="text-success text-body">Notifications are on for this device.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" onClick={sendTest} disabled={isWorking} fullWidth>
                Send a test
              </Button>
              <Button variant="ghost" onClick={disable} disabled={isWorking} fullWidth>
                <BellOff className="size-4" aria-hidden />
                Turn off
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
