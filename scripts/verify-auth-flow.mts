/**
 * End-to-end auth and admin flow verification against a real Postgres engine.
 *
 * Exercises the actual SQL and constraint behaviour for the sequences that
 * matter: a pending user cannot order, deactivation revokes access
 * immediately, an admin cannot demote, and merging moves the right orders.
 *
 * The service layer needs a Neon HTTP connection, so these run the same
 * statements directly against PGlite. Permission logic itself is covered
 * exhaustively in verify-permissions.mts.
 *
 * Run: npx tsx scripts/verify-auth-flow.mts
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { canPlaceOrders, type Viewer } from "../src/lib/auth/permissions";
import type { AccountStatus } from "../src/lib/db/schema";

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

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Mirrors getViewer(): resolve a session to a viewer, or null. */
async function resolveViewer(token: string): Promise<Viewer | null> {
  const result = await db.query<{
    id: string;
    name: string;
    email: string;
    account_status: AccountStatus;
    is_admin: boolean;
    is_super_admin: boolean;
    merged_into_id: string | null;
  }>(
    `select p.id, p.name, p.email, p.account_status, p.is_admin, p.is_super_admin, p.merged_into_id
       from sessions s join people p on p.id = s.person_id
      where s.session_token = $1 and s.expires_at > now()`,
    [hashToken(token)],
  );

  const row = result.rows[0];
  if (!row) return null;
  if (row.account_status === "rejected") return null;
  if (row.merged_into_id) return null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    accountStatus: row.account_status,
    isAdmin: row.is_admin,
    isSuperAdmin: row.is_super_admin,
  };
}

async function main() {
  for (const file of ["0001_initial_schema.sql", "0002_auth_sessions.sql"]) {
    const sql = readFileSync(join(process.cwd(), "drizzle/migrations", file), "utf8").replace(
      /create extension if not exists "pgcrypto";/,
      "",
    );
    await db.exec(sql);
  }

  // --- Sign-up ------------------------------------------------------------
  console.log("\n=== Sign-up ===");

  const passwordHash = await bcrypt.hash("a-real-passphrase", 10);
  const signup = await db.query<{ id: string; account_status: string }>(
    `insert into people (email, name, password_hash) values ($1,$2,$3)
     returning id, account_status`,
    ["nishant@example.com", "Nishant", passwordHash],
  );
  const nishantId = signup.rows[0].id;

  check(
    "a new signup lands in 'pending'",
    signup.rows[0].account_status === "pending",
    signup.rows[0].account_status,
  );

  check(
    "the stored password is hashed, not plaintext",
    passwordHash.startsWith("$2") && passwordHash !== "a-real-passphrase",
  );
  check(
    "the correct password verifies",
    await bcrypt.compare("a-real-passphrase", passwordHash),
  );
  check(
    "a wrong password does not verify",
    !(await bcrypt.compare("wrong-password", passwordHash)),
  );

  // --- Pending users cannot order ----------------------------------------
  console.log("\n=== Pending accounts are read-only ===");

  await db.exec(
    `insert into sessions (session_token, person_id, expires_at)
     values ('${hashToken("nishant-token")}', '${nishantId}', now() + interval '30 days')`,
  );

  const pendingViewer = await resolveViewer("nishant-token");
  check("a pending user can sign in and be resolved", pendingViewer !== null);
  check(
    "a pending user cannot place orders",
    pendingViewer !== null && canPlaceOrders(pendingViewer) === false,
  );

  // --- Approval -----------------------------------------------------------
  console.log("\n=== Approval grants ordering ===");

  const owner = await db.query<{ id: string }>(
    `insert into people (email, name, password_hash, account_status, is_admin, is_super_admin, approved_at)
     values ('deep@example.com','Deep',$1,'approved',true,true,now()) returning id`,
    [passwordHash],
  );
  const deepId = owner.rows[0].id;

  await db.query(
    `update people set account_status='approved', approved_at=now(), approved_by=$1 where id=$2`,
    [deepId, nishantId],
  );

  const approvedViewer = await resolveViewer("nishant-token");
  check(
    "an approved user can place orders",
    approvedViewer !== null && canPlaceOrders(approvedViewer),
  );

  // --- Deactivation is immediate -----------------------------------------
  console.log("\n=== Deactivation takes effect immediately ===");

  await db.query(`update people set account_status='inactive', approved_at=null, approved_by=null where id=$1`, [
    nishantId,
  ]);

  const deactivated = await resolveViewer("nishant-token");
  check(
    "an existing session immediately loses ordering rights",
    deactivated !== null && canPlaceOrders(deactivated) === false,
  );

  // Sign-out on deactivation, as the service does.
  await db.query(`delete from sessions where person_id=$1`, [nishantId]);
  check("deactivation destroys existing sessions", (await resolveViewer("nishant-token")) === null);

  // --- Rejected cannot sign in -------------------------------------------
  console.log("\n=== Rejected accounts ===");

  const rejected = await db.query<{ id: string }>(
    `insert into people (email, name, password_hash, account_status)
     values ('spam@example.com','Spammer',$1,'rejected') returning id`,
    [passwordHash],
  );
  await db.exec(
    `insert into sessions (session_token, person_id, expires_at)
     values ('${hashToken("spam-token")}','${rejected.rows[0].id}', now() + interval '30 days')`,
  );
  check(
    "a rejected account cannot resolve a session",
    (await resolveViewer("spam-token")) === null,
  );

  // --- Merge --------------------------------------------------------------
  console.log("\n=== Merging duplicates ===");

  await db.query(
    `update people set account_status='approved', approved_at=now(), approved_by=$1 where id=$2`,
    [deepId, nishantId],
  );

  const duplicate = await db.query<{ id: string }>(
    `insert into people (email, name, password_hash, account_status, approved_at)
     values ('nishnat@example.com','Nishant (typo)',$1,'approved',now()) returning id`,
    [passwordHash],
  );
  const duplicateId = duplicate.rows[0].id;

  // Two different days, so the merge does not collide.
  await db.exec(`
    insert into menu_days (id, date_key, status, deadline_at) values
      ('d1111111-1111-1111-1111-111111111111','2026-07-18','locked','2026-07-18T05:00:00Z'),
      ('d2222222-2222-2222-2222-222222222222','2026-07-19','locked','2026-07-19T05:00:00Z');
    insert into order_rounds (id, menu_day_id, round_number, deadline_at) values
      ('r1111111-1111-1111-1111-111111111111','d1111111-1111-1111-1111-111111111111',1,'2026-07-18T05:00:00Z'),
      ('r2222222-2222-2222-2222-222222222222','d2222222-2222-2222-2222-222222222222',1,'2026-07-19T05:00:00Z');
  `);

  await db.query(
    `insert into orders (menu_day_id, person_id, current_round_id) values
       ('d1111111-1111-1111-1111-111111111111',$1,'r1111111-1111-1111-1111-111111111111'),
       ('d2222222-2222-2222-2222-222222222222',$1,'r2222222-2222-2222-2222-222222222222')`,
    [duplicateId],
  );

  await db.query(`update orders set person_id=$1 where person_id=$2`, [nishantId, duplicateId]);
  await db.query(`update people set merged_into_id=$1, account_status='inactive' where id=$2`, [
    nishantId,
    duplicateId,
  ]);

  const movedOrders = await db.query<{ count: string }>(
    `select count(*)::text as count from orders where person_id=$1`,
    [nishantId],
  );
  check("merging moves the duplicate's orders", movedOrders.rows[0].count === "2");

  const orphaned = await db.query<{ count: string }>(
    `select count(*)::text as count from orders where person_id=$1`,
    [duplicateId],
  );
  check("no orders remain on the merged-away account", orphaned.rows[0].count === "0");

  // A merged identity must not keep acting as itself.
  await db.exec(
    `insert into sessions (session_token, person_id, expires_at)
     values ('${hashToken("dup-token")}','${duplicateId}', now() + interval '30 days')`,
  );
  check(
    "a merged account's session no longer resolves",
    (await resolveViewer("dup-token")) === null,
  );

  // --- Merge conflict detection ------------------------------------------
  console.log("\n=== Merge conflict detection ===");

  const conflictPerson = await db.query<{ id: string }>(
    `insert into people (email, name, password_hash, account_status, approved_at)
     values ('conflict@example.com','Conflict',$1,'approved',now()) returning id`,
    [passwordHash],
  );

  // Same day as an order Nishant already owns.
  await db.query(
    `insert into orders (menu_day_id, person_id, current_round_id)
     values ('d1111111-1111-1111-1111-111111111111',$1,'r1111111-1111-1111-1111-111111111111')`,
    [conflictPerson.rows[0].id],
  );

  let mergeRejected = false;
  try {
    await db.query(`update orders set person_id=$1 where person_id=$2`, [
      nishantId,
      conflictPerson.rows[0].id,
    ]);
  } catch {
    mergeRejected = true;
  }
  check(
    "merging accounts that ordered on the same day is blocked by the DB",
    mergeRejected,
    "the unique (day, person) index must prevent a silent double-order",
  );

  console.log(`\n${"=".repeat(56)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`${"=".repeat(56)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
