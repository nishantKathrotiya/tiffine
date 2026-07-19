/**
 * Schema verification against a real Postgres engine (PGlite/WASM).
 *
 * Applies the migration and asserts the constraints that protect billing
 * correctness actually fire. These are the guarantees the whole design rests
 * on, so they are tested against the engine rather than assumed.
 *
 * Run: npx tsx scripts/verify-schema.mts
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const db = new PGlite();
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

/** Assert that a statement is rejected by the database. */
async function expectReject(label: string, sql: string, expectFragment?: string) {
  try {
    await db.exec(sql);
    check(label, false, "statement was accepted but should have been rejected");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const matched = !expectFragment || message.toLowerCase().includes(expectFragment.toLowerCase());
    check(label, matched, matched ? "" : `unexpected error: ${message}`);
  }
}

async function main() {
  // PGlite has no pgcrypto extension, but gen_random_uuid() is built into
  // Postgres 13+. Drop only the extension line; everything else runs as-is.
  const migrationFiles = ["0001_initial_schema.sql", "0002_auth_sessions.sql"];

  console.log("\n=== Migrations apply ===");
  for (const file of migrationFiles) {
    const sql = readFileSync(join(process.cwd(), "drizzle/migrations", file), "utf8").replace(
      /create extension if not exists "pgcrypto";/,
      "",
    );
    try {
      await db.exec(sql);
      check(`${file} runs without error`, true);
    } catch (error) {
      check(`${file} runs without error`, false, String(error));
      console.log("\nCannot continue without a schema.\n");
      process.exit(1);
    }
  }

  // --- Fixtures -----------------------------------------------------------
  await db.exec(`
    insert into people (id, email, name, is_admin, is_super_admin, account_status, approved_at) values
      ('11111111-1111-1111-1111-111111111111', 'deep@example.com', 'Deep', true, true, 'approved', now()),
      ('22222222-2222-2222-2222-222222222222', 'nishant@example.com', 'Nishant', false, false, 'approved', now());

    insert into menu_days (id, date_key, status, deadline_at) values
      ('33333333-3333-3333-3333-333333333333', '2026-07-19', 'published', '2026-07-19T05:00:00Z');

    insert into order_rounds (id, menu_day_id, round_number, deadline_at) values
      ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 1, '2026-07-19T05:00:00Z');

    insert into menu_items (id, menu_day_id, order_round_id, name, normalized_name, unit_price_paise) values
      ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'Paneer', 'paneer', 6000),
      ('66666666-6666-6666-6666-666666666666', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'Dal', 'dal', 4000);

    insert into orders (id, menu_day_id, person_id, current_round_id) values
      ('77777777-7777-7777-7777-777777777777', '33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444');
  `);

  // --- The core guarantee -------------------------------------------------
  console.log("\n=== Double-billing guards (the paneer→dal bug) ===");

  await expectReject(
    "a person cannot hold two orders on one day",
    `insert into orders (menu_day_id, person_id, current_round_id)
     values ('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222','44444444-4444-4444-4444-444444444444');`,
    "unique",
  );

  await db.exec(`
    insert into settlement_runs (id, period_start, period_end, status)
    values ('88888888-8888-8888-8888-888888888888','2026-07-01','2026-07-20','committed'),
           ('99999999-9999-9999-9999-999999999999','2026-07-15','2026-08-05','committed');
    insert into settled_days (settlement_run_id, menu_day_id)
    values ('88888888-8888-8888-8888-888888888888','33333333-3333-3333-3333-333333333333');
  `);

  await expectReject(
    "a day cannot be billed by two settlement runs",
    `insert into settled_days (settlement_run_id, menu_day_id)
     values ('99999999-9999-9999-9999-999999999999','33333333-3333-3333-3333-333333333333');`,
    "unique",
  );

  // --- Data integrity -----------------------------------------------------
  console.log("\n=== Data integrity ===");

  await expectReject(
    "quantity must be positive",
    `insert into order_lines (order_id, menu_item_id, quantity, unit_price_paise_snapshot, item_name_snapshot)
     values ('77777777-7777-7777-7777-777777777777','55555555-5555-5555-5555-555555555555',0,6000,'Paneer');`,
    "quantity_positive",
  );

  await expectReject(
    "negative prices are rejected",
    `insert into menu_items (menu_day_id, order_round_id, name, normalized_name, unit_price_paise)
     values ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444','Bad','bad',-100);`,
    "price_non_negative",
  );

  await expectReject(
    "emails must be stored lowercase",
    `insert into people (email, name) values ('MixedCase@Example.com','Mixed');`,
    "lowercase",
  );

  // --- Accounts and roles -------------------------------------------------
  console.log("\n=== Account status and roles ===");

  await expectReject(
    "a super-admin must also be an admin",
    `insert into people (email, name, is_admin, is_super_admin)
     values ('bad@example.com','Bad', false, true);`,
    "super_admin_is_admin",
  );

  await expectReject(
    "there can only be one super-admin",
    `insert into people (email, name, is_admin, is_super_admin, account_status, approved_at)
     values ('second@example.com','Second', true, true, 'approved', now());`,
    "unique",
  );

  await expectReject(
    "an approved account must record when it was approved",
    `insert into people (email, name, account_status)
     values ('noapprover@example.com','No Approver', 'approved');`,
    "approved_has_approver",
  );

  // New signups must land in 'pending' — defaulting to approved would let
  // anyone with the URL start ordering.
  await db.exec(
    `insert into people (id, email, name)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','newbie@example.com','Newbie');`,
  );
  const newSignup = await db.query<{ account_status: string; is_admin: boolean }>(
    `select account_status, is_admin from people where email='newbie@example.com';`,
  );
  check(
    "a new signup defaults to pending and non-admin",
    newSignup.rows[0].account_status === "pending" && newSignup.rows[0].is_admin === false,
    JSON.stringify(newSignup.rows[0]),
  );

  // Deactivating must preserve history, not delete the person.
  await db.exec(`update people set account_status='inactive' where email='newbie@example.com';`);
  const stillThere = await db.query<{ count: string }>(
    `select count(*)::text as count from people where email='newbie@example.com';`,
  );
  check(
    "deactivating a person keeps their row (history preserved)",
    stillThere.rows[0].count === "1",
  );

  await expectReject(
    "duplicate emails are rejected (case-insensitively)",
    `insert into people (email, name) values ('nishant@example.com','Impostor');`,
    "unique",
  );

  await expectReject(
    "a published day must have a deadline",
    `insert into menu_days (date_key, status) values ('2026-07-25','published');`,
    "needs_deadline",
  );

  await expectReject(
    "settlement period cannot end before it starts",
    `insert into settlement_runs (period_start, period_end) values ('2026-07-20','2026-07-01');`,
    "period_ordered",
  );

  await expectReject(
    "a person cannot be merged into themselves",
    `update people set merged_into_id = id where email = 'nishant@example.com';`,
    "merged_into_self",
  );

  // --- Cancellation -------------------------------------------------------
  console.log("\n=== Cancellation rules ===");

  await db.exec(`
    insert into cancellation_requests (order_id, person_id, reason)
    values ('77777777-7777-7777-7777-777777777777','22222222-2222-2222-2222-222222222222','Out sick');
  `);

  await expectReject(
    "only one pending cancellation per order",
    `insert into cancellation_requests (order_id, person_id, reason)
     values ('77777777-7777-7777-7777-777777777777','22222222-2222-2222-2222-222222222222','Again');`,
    "unique",
  );

  await expectReject(
    "a decided request must record when it was decided",
    `update cancellation_requests set status = 'approved' where status = 'pending';`,
    "decided_consistently",
  );

  // Approving correctly (with decided_at) must succeed, and must then allow a
  // new request — otherwise a rejected person could never re-request.
  await db.exec(`
    update cancellation_requests
       set status='approved', decided_at=now(), decided_by='11111111-1111-1111-1111-111111111111'
     where status='pending';
    insert into cancellation_requests (order_id, person_id, reason)
    values ('77777777-7777-7777-7777-777777777777','22222222-2222-2222-2222-222222222222','New request');
  `);
  const openRequests = await db.query<{ count: string }>(
    `select count(*)::text as count from cancellation_requests where status='pending'`,
  );
  check(
    "a new request is allowed once the previous one is decided",
    openRequests.rows[0].count === "1",
  );

  // --- Sessions -----------------------------------------------------------
  console.log("\n=== Sessions ===");

  await db.exec(`
    insert into people (id, email, name, account_status, approved_at)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','temp@example.com','Temp','approved',now());
    insert into sessions (session_token, person_id, expires_at)
    values ('token-a','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', now() + interval '30 days');
  `);

  await expectReject(
    "session tokens are unique",
    `insert into sessions (session_token, person_id, expires_at)
     values ('token-a','22222222-2222-2222-2222-222222222222', now() + interval '30 days');`,
    "unique",
  );

  // Deleting a person must not orphan their sessions.
  await db.exec(`delete from people where id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';`);
  const orphaned = await db.query<{ count: string }>(
    `select count(*)::text as count from sessions where session_token='token-a';`,
  );
  check("deleting a person cascades their sessions", orphaned.rows[0].count === "0");

  // --- Money is integer paise --------------------------------------------
  console.log("\n=== Money storage ===");
  const moneyColumns = await db.query<{ column_name: string; data_type: string }>(`
    select column_name, data_type from information_schema.columns
    where table_schema='public' and (column_name like '%paise%')
    order by table_name, column_name;
  `);
  const allBigint = moneyColumns.rows.every((r) => r.data_type === "bigint");
  check(
    `every *_paise column is bigint (${moneyColumns.rows.length} checked)`,
    allBigint && moneyColumns.rows.length > 0,
    allBigint ? "" : JSON.stringify(moneyColumns.rows.filter((r) => r.data_type !== "bigint")),
  );

  // --- Price snapshot survives a menu price change ------------------------
  console.log("\n=== Price snapshotting ===");
  await db.exec(`
    insert into order_lines (order_id, menu_item_id, quantity, unit_price_paise_snapshot, item_name_snapshot)
    values ('77777777-7777-7777-7777-777777777777','55555555-5555-5555-5555-555555555555',2,6000,'Paneer');
    update menu_items set unit_price_paise = 9900 where id='55555555-5555-5555-5555-555555555555';
  `);
  const snapshot = await db.query<{ snap: string; live: string }>(`
    select ol.unit_price_paise_snapshot::text as snap, mi.unit_price_paise::text as live
    from order_lines ol join menu_items mi on mi.id = ol.menu_item_id
    where ol.order_id='77777777-7777-7777-7777-777777777777';
  `);
  check(
    "a mid-period price rise does not re-price an existing order",
    snapshot.rows[0].snap === "6000" && snapshot.rows[0].live === "9900",
    `snapshot=${snapshot.rows[0].snap} live=${snapshot.rows[0].live}`,
  );

  console.log(`\n${"=".repeat(52)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`${"=".repeat(52)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
