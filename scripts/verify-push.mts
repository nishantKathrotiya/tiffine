/**
 * Push notification contract verification.
 *
 * Web Push cannot be exercised end-to-end in headless Chromium (it hard-denies
 * the Notification permission), so this asserts the rules that actually break
 * in production instead — all of them iOS-specific, and all of them silent
 * failures that Chrome papers over during development.
 *
 * Real-device testing is still required; see the notes at the end of the run.
 *
 * Run: npx tsx scripts/verify-push.mts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import webpush from "web-push";
import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("\n=== VAPID configuration ===");

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  const subject = process.env.VAPID_SUBJECT ?? "";

  check("public key present (87 chars)", publicKey.length === 87, `len ${publicKey.length}`);
  check("private key present (43 chars)", privateKey.length === 43, `len ${privateKey.length}`);
  check("subject is a mailto:", subject.startsWith("mailto:"));

  let configured = true;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch {
    configured = false;
  }
  check("web-push accepts the key pair", configured);

  // --- The iOS rules -------------------------------------------------------
  console.log("\n=== Service worker contract ===");

  const sw = readFileSync("public/sw.js", "utf8");

  check(
    "push handler wraps its work in event.waitUntil",
    /addEventListener\("push"[\s\S]{0,200}event\.waitUntil/.test(sw),
  );
  check("calls showNotification", sw.includes("showNotification"));

  // The one that matters most: iOS cancels a subscription after 3 pushes that
  // don't render. A malformed payload must still show something.
  const pushBlock = sw.slice(
    sw.indexOf('addEventListener("push"'),
    sw.indexOf('addEventListener("notificationclick"'),
  );
  const catchIndex = pushBlock.indexOf("catch");
  const showIndex = pushBlock.indexOf("showNotification");
  check(
    "a malformed payload still renders a notification (no early return)",
    catchIndex > -1 && showIndex > catchIndex && !/catch[\s\S]{0,120}return;/.test(pushBlock),
  );

  check("notificationclick focuses an existing tab", sw.includes("clients.matchAll"));
  check("handles pushsubscriptionchange", sw.includes("pushsubscriptionchange"));
  check(
    "no offline caching — order state must always come from the server",
    !sw.includes("caches.open"),
  );

  console.log("\n=== Client subscribe contract ===");

  const client = readFileSync("src/components/notification-settings.tsx", "utf8");

  check("uses userVisibleOnly: true", client.includes("userVisibleOnly: true"));

  // Must not call subscription.unsubscribe(): Safari then refuses to
  // re-subscribe without a fresh user gesture.
  //
  // Comments are stripped first — the file explains *why* we avoid this call,
  // and matching that prose would fail the check on correct code.
  const clientCode = client
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  check(
    "never calls subscription.unsubscribe() (would break Safari re-subscribe)",
    !/\.\s*unsubscribe\s*\(/.test(clientCode),
  );

  check("detects the iOS-needs-install case", client.includes("ios-needs-install"));
  check("walks through Add to Home Screen", client.includes("Add to Home Screen"));

  console.log("\n=== Payload encryption ===");

  // Syntactically valid but unreachable: proves a real encrypted request is
  // built and that a dead endpoint surfaces the status code we prune on.
  const deadEndpoint = {
    endpoint: "https://fcm.googleapis.com/fcm/send/fake-endpoint-for-testing",
    keys: {
      p256dh:
        "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
      auth: "tBHItJI5svbpez7KI4CCXg",
    },
  };

  try {
    await webpush.sendNotification(deadEndpoint, JSON.stringify({ title: "t", body: "b" }), {
      TTL: 60,
    });
    check("dispatch against a dead endpoint should not succeed", false);
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    check(
      `payload encrypted and dispatched (endpoint replied ${statusCode})`,
      typeof statusCode === "number",
    );
    check(
      "dead-subscription status is one we deactivate on",
      statusCode === 404 || statusCode === 410 || statusCode === 400,
      `got ${statusCode}`,
    );
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`${"=".repeat(60)}`);
  console.log(
    "\n  NOT covered here — needs a physical device:\n" +
      "    · iOS: Add to Home Screen, then subscribe and receive\n" +
      "    · iOS: send 4+ consecutive pushes and confirm the subscription survives\n" +
      "    · Android: confirm delivery with the app backgrounded\n",
  );

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
