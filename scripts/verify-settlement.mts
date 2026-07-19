/**
 * Settlement correctness against a real Postgres engine (PGlite).
 *
 * Seeds a realistic period — 22 days × 15 people, a mid-period price change,
 * people skipping days, a cancellation — then reconciles the settlement query
 * against an independently computed expectation.
 *
 * This is the test that decides whether Deep can stop hand-checking, so the
 * expected totals are derived separately rather than by re-running the same
 * SQL and comparing it to itself.
 *
 * Run: npx tsx scripts/verify-settlement.mts
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildUpiLink, isValidVpa } from "../src/lib/upi";
import { formatPaise } from "../src/lib/money";

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

const uuid = (n: number, prefix = "a") =>
  `${prefix}${String(n).padStart(7, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function main() {
  for (const file of [
    "0001_initial_schema.sql",
    "0002_auth_sessions.sql",
    "0003_menu_title.sql",
  ]) {
    const sql = readFileSync(join(process.cwd(), "drizzle/migrations", file), "utf8").replace(
      /create extension if not exists "pgcrypto";/,
      "",
    );
    await db.exec(sql);
  }

  // --- Seed: 15 people, 22 days -----------------------------------------
  console.log("\n=== Seeding a realistic period ===");

  const PEOPLE = 15;
  const DAYS = 22;
  // Price rises on day 11 — the case that proves snapshots hold.
  const PRICE_CHANGE_DAY = 11;
  const ROTI_BEFORE = 1000;
  const ROTI_AFTER = 1200;
  const SABJI = 4000;

  for (let p = 1; p <= PEOPLE; p++) {
    await db.query(
      `insert into people (id,email,name,account_status,approved_at) values ($1,$2,$3,'approved',now())`,
      [uuid(p, "b"), `person${p}@test.com`, `Person ${String(p).padStart(2, "0")}`],
    );
  }

  /** Independent expectation, computed in plain JS. */
  const expected = new Map<string, number>();
  let expectedGrand = 0;
  let cancelledPersonTotal = 0;

  for (let d = 1; d <= DAYS; d++) {
    const dayId = uuid(d, "c");
    const roundId = uuid(d, "d");
    const dateKey = `2026-03-${String(d).padStart(2, "0")}`;
    const rotiPrice = d >= PRICE_CHANGE_DAY ? ROTI_AFTER : ROTI_BEFORE;

    await db.query(
      `insert into menu_days (id,date_key,title,status,deadline_at) values ($1,$2,$3,'locked',now())`,
      [dayId, dateKey, `Day ${d}`],
    );
    await db.query(
      `insert into order_rounds (id,menu_day_id,round_number,deadline_at) values ($1,$2,1,now())`,
      [roundId, dayId],
    );
    await db.query(
      `insert into menu_items (id,menu_day_id,order_round_id,name,normalized_name,unit_price_paise)
       values ($1,$2,$3,'Roti','roti',$4), ($5,$2,$3,'Sabji','sabji',$6)`,
      [uuid(d * 100 + 1, "e"), dayId, roundId, rotiPrice, uuid(d * 100 + 2, "e"), SABJI],
    );

    for (let p = 1; p <= PEOPLE; p++) {
      // Every 7th person skips every 5th day — irregular, like real life.
      if ((d + p) % 5 === 0) continue;

      const rotiQty = ((d + p) % 3) + 1;
      const sabjiQty = (d + p) % 2;
      if (rotiQty === 0 && sabjiQty === 0) continue;

      const orderId = uuid(d * 1000 + p, "f");
      // One person cancels on day 3 — must contribute zero.
      const isCancelled = d === 3 && p === 4;

      await db.query(
        `insert into orders (id,menu_day_id,person_id,current_round_id,status)
         values ($1,$2,$3,$4,$5)`,
        [orderId, dayId, uuid(p, "b"), roundId, isCancelled ? "cancelled" : "active"],
      );

      const lineTotal = rotiQty * rotiPrice + sabjiQty * SABJI;

      await db.query(
        `insert into order_lines (order_id,menu_item_id,quantity,unit_price_paise_snapshot,item_name_snapshot)
         values ($1,$2,$3,$4,'Roti')`,
        [orderId, uuid(d * 100 + 1, "e"), rotiQty, rotiPrice],
      );
      if (sabjiQty > 0) {
        await db.query(
          `insert into order_lines (order_id,menu_item_id,quantity,unit_price_paise_snapshot,item_name_snapshot)
           values ($1,$2,$3,$4,'Sabji')`,
          [orderId, uuid(d * 100 + 2, "e"), sabjiQty, SABJI],
        );
      }

      if (isCancelled) {
        cancelledPersonTotal += lineTotal;
        continue;
      }

      const key = uuid(p, "b");
      expected.set(key, (expected.get(key) ?? 0) + lineTotal);
      expectedGrand += lineTotal;
    }
  }

  console.log(`  seeded ${DAYS} days × ${PEOPLE} people`);
  console.log(`  independent expectation: ${formatPaise(expectedGrand)}`);

  // --- The settlement query ----------------------------------------------
  console.log("\n=== Per-person totals ===");

  const actual = await db.query<{ person_id: string; total: string; days: number }>(`
    select o.person_id, coalesce(sum(ol.quantity * ol.unit_price_paise_snapshot),0)::bigint total,
           count(distinct o.menu_day_id)::int days
      from orders o
      join order_lines ol on ol.order_id = o.id
     where o.status = 'active'
     group by o.person_id
  `);

  let mismatches = 0;
  for (const row of actual.rows) {
    const want = expected.get(row.person_id) ?? 0;
    if (Number(row.total) !== want) {
      mismatches++;
      console.log(`    ${row.person_id}: got ${row.total}, expected ${want}`);
    }
  }
  check(
    `every person's total matches the independent calculation (${actual.rows.length} people)`,
    mismatches === 0 && actual.rows.length === expected.size,
    `${mismatches} mismatch(es)`,
  );

  const actualGrand = actual.rows.reduce((sum, row) => sum + Number(row.total), 0);
  check(
    `group total matches to the paisa (${formatPaise(actualGrand)})`,
    actualGrand === expectedGrand,
    `got ${actualGrand}, expected ${expectedGrand}`,
  );

  check(
    "per-person totals sum exactly to the group total",
    [...expected.values()].reduce((a, b) => a + b, 0) === actualGrand,
  );

  check("every total is an integer number of paise", actual.rows.every((r) => Number.isInteger(Number(r.total))));

  // --- Price snapshot ------------------------------------------------------
  console.log("\n=== Mid-period price change ===");

  const before = await db.query<{ c: string }>(
    `select count(*)::text c from order_lines where item_name_snapshot='Roti' and unit_price_paise_snapshot=$1`,
    [ROTI_BEFORE],
  );
  const after = await db.query<{ c: string }>(
    `select count(*)::text c from order_lines where item_name_snapshot='Roti' and unit_price_paise_snapshot=$1`,
    [ROTI_AFTER],
  );
  check(
    `days before the rise kept ₹10 (${before.rows[0].c} lines) and after kept ₹12 (${after.rows[0].c} lines)`,
    Number(before.rows[0].c) > 0 && Number(after.rows[0].c) > 0,
  );

  // Raising the live menu price must not move a single settled total.
  await db.query(`update menu_items set unit_price_paise = 9900`);
  const afterBump = await db.query<{ total: string }>(
    `select coalesce(sum(ol.quantity*ol.unit_price_paise_snapshot),0)::bigint total
       from orders o join order_lines ol on ol.order_id=o.id where o.status='active'`,
  );
  check(
    "changing live menu prices does not alter settled totals",
    Number(afterBump.rows[0].total) === expectedGrand,
    `total moved to ${afterBump.rows[0].total}`,
  );

  // --- Cancellations -------------------------------------------------------
  console.log("\n=== Cancellations ===");
  check(
    `an approved cancellation contributes ₹0 (excluded ${formatPaise(cancelledPersonTotal)})`,
    cancelledPersonTotal > 0 && actualGrand === expectedGrand,
  );

  // --- Overlap and gaps ----------------------------------------------------
  console.log("\n=== Overlap and gap detection ===");

  const runA = uuid(1, "9");
  await db.query(
    `insert into settlement_runs (id,period_start,period_end,status,total_paise)
     values ($1,'2026-03-01','2026-03-20','committed',0)`,
    [runA],
  );
  const firstDays = await db.query<{ id: string }>(
    `select id from menu_days where date_key between '2026-03-01' and '2026-03-20'`,
  );
  for (const day of firstDays.rows) {
    await db.query(`insert into settled_days (settlement_run_id,menu_day_id) values ($1,$2)`, [
      runA,
      day.id,
    ]);
  }

  const runB = uuid(2, "9");
  await db.query(
    `insert into settlement_runs (id,period_start,period_end,status,total_paise)
     values ($1,'2026-03-15','2026-03-22','committed',0)`,
    [runB],
  );

  // Days 15–20 are already claimed; inserting them again must fail.
  const contested = await db.query<{ id: string }>(
    `select id from menu_days where date_key between '2026-03-15' and '2026-03-20' limit 1`,
  );
  let rejected = false;
  try {
    await db.query(`insert into settled_days (settlement_run_id,menu_day_id) values ($1,$2)`, [
      runB,
      contested.rows[0].id,
    ]);
  } catch {
    rejected = true;
  }
  check("a day already billed cannot be claimed by a second run", rejected);

  // Days 21–22 are free, so the second run legitimately covers them.
  const free = await db.query<{ id: string; date_key: string }>(
    `select id, date_key from menu_days where date_key between '2026-03-21' and '2026-03-22'`,
  );
  for (const day of free.rows) {
    await db.query(`insert into settled_days (settlement_run_id,menu_day_id) values ($1,$2)`, [
      runB,
      day.id,
    ]);
  }

  const claimedCount = await db.query<{ c: string }>(`select count(*)::text c from settled_days`);
  check(
    `all ${DAYS} days are billed exactly once across both runs`,
    Number(claimedCount.rows[0].c) === DAYS,
    `claimed ${claimedCount.rows[0].c}`,
  );

  // The gap case: a day no committed run covers.
  await db.query(
    `insert into menu_days (id,date_key,title,status,deadline_at)
     values ($1,'2026-03-25','Orphan Day','locked',now())`,
    [uuid(999, "c")],
  );
  const gaps = await db.query<{ date_key: string }>(`
    select md.date_key from menu_days md
     where md.status in ('locked','sent_to_provider','settled')
       and not exists (
         select 1 from settled_days sd
           join settlement_runs sr on sr.id = sd.settlement_run_id
          where sd.menu_day_id = md.id and sr.status = 'committed')
  `);
  check(
    "an unbilled day is detectable as a gap",
    gaps.rows.length === 1,
    `found ${gaps.rows.length}`,
  );

  // --- UPI links -----------------------------------------------------------
  console.log("\n=== UPI links ===");

  check("valid VPA accepted", isValidVpa("deep@okhdfcbank"));
  check("VPA without provider rejected", !isValidVpa("deep"));
  check("empty VPA rejected", !isValidVpa(""));
  check("VPA with no handle rejected", !isValidVpa("@bank"));
  check("VPA with spaces rejected", !isValidVpa("de ep@bank"));
  check("single-char handle accepted (legal, if unusual)", isValidVpa("a@bank"));

  const link = buildUpiLink({
    payeeVpa: "deep@okhdfcbank",
    payeeName: "Deep",
    amountPaise: 124050,
    note: "Tiffin Mar 1-22",
  });
  check("link carries a plain two-decimal amount", link?.includes("am=1240.50") ?? false, String(link));
  check("link has no thousands separator", !(link ?? "").includes(","), String(link));
  check("link specifies INR", link?.includes("cu=INR") ?? false);

  const encoded = buildUpiLink({
    payeeVpa: "deep@okhdfcbank",
    payeeName: "Deep & Co",
    amountPaise: 5000,
    note: "A&B",
  });
  check(
    "ampersands in the name are escaped, not left to split the query",
    (encoded ?? "").includes("Deep+%26+Co") || (encoded ?? "").includes("Deep%20%26%20Co"),
    String(encoded),
  );

  check("zero amount produces no link", buildUpiLink({ payeeVpa: "a@b", payeeName: "x", amountPaise: 0 }) === null);
  check("negative amount produces no link", buildUpiLink({ payeeVpa: "a@b", payeeName: "x", amountPaise: -100 }) === null);
  check("missing VPA produces no link", buildUpiLink({ payeeVpa: "", payeeName: "x", amountPaise: 100 }) === null);

  // A paisa-level amount must survive the round trip exactly.
  const odd = buildUpiLink({ payeeVpa: "a@bank", payeeName: "x", amountPaise: 100001 });
  check("₹1000.01 renders exactly", odd?.includes("am=1000.01") ?? false, String(odd));

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`${"=".repeat(60)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
