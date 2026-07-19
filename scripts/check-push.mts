/**
 * Why is nobody receiving notifications?
 *
 * Walks the chain in order — config, then subscriptions, then delivery — and
 * stops at the first broken link, because a later check can't pass while an
 * earlier one is failing.
 *
 *   npx tsx scripts/check-push.mts [https://your-app.vercel.app]
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const appUrl = process.argv[2] ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL!);

console.log("\n1. Local VAPID config");
const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
console.log(`   public key : ${pub ? `set (${pub.slice(0, 12)}…)` : "MISSING"}`);
console.log(`   private key: ${process.env.VAPID_PRIVATE_KEY ? "set" : "MISSING"}`);
console.log(`   subject    : ${process.env.VAPID_SUBJECT ?? "MISSING"}`);

console.log("\n2. Deployed app");
if (!appUrl || appUrl.includes("localhost")) {
  console.log("   no public URL configured — pass one as an argument");
} else {
  for (const path of ["/api/health", "/sw.js", "/manifest.webmanifest"]) {
    try {
      const res = await fetch(appUrl + path);
      console.log(`   ${path.padEnd(24)} ${res.status}`);
    } catch {
      console.log(`   ${path.padEnd(24)} unreachable`);
    }
  }
}

console.log("\n3. Saved subscriptions");
const subs = await sql`select ps.is_active, ps.last_failed_at, p.name, p.account_status,
  substring(ps.user_agent from 1 for 50) ua
  from push_subscriptions ps join people p on p.id = ps.person_id
  order by ps.created_at desc`;

if (subs.length === 0) {
  console.log("   NONE — no browser has completed the subscribe step.");
  console.log("   Nothing can be delivered until someone taps");
  console.log("   Settings -> Turn on notifications and it succeeds.");
} else {
  for (const s of subs) {
    console.log(`   ${s.name} [${s.account_status}] active=${s.is_active}` +
      (s.last_failed_at ? ` lastFailed=${new Date(s.last_failed_at).toISOString()}` : ""));
    console.log(`      ${s.ua ?? "?"}`);
  }
}

console.log("");
