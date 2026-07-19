/**
 * Is the deadline sweeper actually running?
 *
 * Two independent signals, because "the endpoint works" and "something is
 * calling it on a schedule" are different questions:
 *
 *   1. Automatic closes in the audit trail (actor_id is null — a person
 *      closing a day early records their id instead).
 *   2. Days sitting past their deadline but still `published`, which is the
 *      symptom of nothing sweeping them.
 *
 * Run: npx tsx scripts/check-cron.mts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL!);

console.log("\n=== Automatic closes (the sweeper's fingerprint) ===");

const autoLocks = await sql`
  select created_at, entity_id, detail
    from audit_log
   where action = 'day.lock'
     and actor_id is null
   order by created_at desc
   limit 5
`;

if (autoLocks.length === 0) {
  console.log("  none found — the sweeper has never closed a day");
  console.log("  (expected if no deadline has passed yet since deploying)");
} else {
  for (const row of autoLocks) {
    console.log(`  ${new Date(row.created_at).toISOString()}  day ${row.entity_id}`);
  }
}

console.log("\n=== Days overdue but still open (the symptom) ===");

const overdue = await sql`
  select date_key::text k, title, deadline_at,
         extract(epoch from (now() - deadline_at)) / 60 as minutes_overdue
    from menu_days
   where status = 'published'
     and deadline_at < now()
   order by deadline_at
`;

if (overdue.length === 0) {
  console.log("  none — nothing is waiting to be closed");
} else {
  for (const row of overdue) {
    const mins = Math.round(Number(row.minutes_overdue));
    // Anything beyond ~5 minutes means no scheduler is hitting the endpoint.
    const verdict = mins > 6 ? "  <-- NOT being swept" : "(within the 5-min window)";
    console.log(`  ${row.k}  "${row.title}"  ${mins} min overdue ${verdict}`);
  }
}

console.log("\n=== Recent session pruning (runs on every sweep) ===");

const [sessions] = await sql`select count(*)::int c from sessions where expires_at < now()`;
console.log(`  expired sessions still present: ${sessions.c}`);
console.log("  (a sweep clears these, so a growing number means it isn't running)");

console.log("");
