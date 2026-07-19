/**
 * Permission matrix verification.
 *
 * These rules decide whether an unapproved stranger can add themselves to the
 * provider's count, and whether the group can lock itself out of admin access.
 * Both are worth testing exhaustively rather than by inspection.
 *
 * Run: npx tsx scripts/verify-permissions.mts
 */
import {
  assertCanChangeRole,
  canDemoteAdmin,
  canPlaceOrders,
  canPromoteToAdmin,
  canSignIn,
  canViewDashboard,
  getOrderingBlockedReason,
  isActiveAdmin,
  type Viewer,
} from "../src/lib/auth/permissions";
import type { AccountStatus } from "../src/lib/db/schema";

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

function expectThrows(label: string, fn: () => void) {
  try {
    fn();
    check(label, false, "expected a refusal but the action was allowed");
  } catch {
    check(label, true);
  }
}

function expectAllows(label: string, fn: () => void) {
  try {
    fn();
    check(label, true);
  } catch (error) {
    check(label, false, `unexpectedly refused: ${(error as Error).message}`);
  }
}

const person = (
  status: AccountStatus,
  opts: { isAdmin?: boolean; isSuperAdmin?: boolean; id?: string } = {},
): Viewer => ({
  id: opts.id ?? "person-1",
  name: "Test",
  email: "test@example.com",
  accountStatus: status,
  isAdmin: opts.isAdmin ?? false,
  isSuperAdmin: opts.isSuperAdmin ?? false,
});

const ALL_STATUSES: AccountStatus[] = ["pending", "approved", "inactive", "rejected"];

// --- Ordering ---------------------------------------------------------------
console.log("\n=== Ordering requires approval ===");
for (const status of ALL_STATUSES) {
  const expected = status === "approved";
  check(
    `${status.padEnd(8)} can place orders = ${expected}`,
    canPlaceOrders(person(status)) === expected,
  );
}

// An admin flag must not bypass the approval gate.
check(
  "an unapproved admin still cannot order",
  canPlaceOrders(person("pending", { isAdmin: true })) === false,
);
check(
  "an inactive super-admin still cannot order",
  canPlaceOrders(person("inactive", { isAdmin: true, isSuperAdmin: true })) === false,
);

// --- Sign-in and viewing ----------------------------------------------------
console.log("\n=== Sign-in and dashboard access ===");
for (const status of ALL_STATUSES) {
  const expected = status !== "rejected";
  check(`${status.padEnd(8)} can sign in = ${expected}`, canSignIn(status) === expected);
  check(
    `${status.padEnd(8)} can view dashboard = ${expected}`,
    canViewDashboard(person(status)) === expected,
  );
}

// --- Admin powers -----------------------------------------------------------
console.log("\n=== Admin powers follow account status ===");
check("an approved admin is an active admin", isActiveAdmin(person("approved", { isAdmin: true })));
check(
  "deactivating an admin revokes admin powers",
  isActiveAdmin(person("inactive", { isAdmin: true })) === false,
);
check(
  "a pending admin has no admin powers",
  isActiveAdmin(person("pending", { isAdmin: true })) === false,
);
check("a non-admin is not an admin", isActiveAdmin(person("approved")) === false);

// --- Promote / demote asymmetry --------------------------------------------
console.log("\n=== Promote is open to admins; demote is owner-only ===");
const owner = person("approved", { isAdmin: true, isSuperAdmin: true, id: "owner" });
const admin = person("approved", { isAdmin: true, id: "admin" });
const member = person("approved", { id: "member" });

check("an admin can promote", canPromoteToAdmin(admin));
check("the owner can promote", canPromoteToAdmin(owner));
check("a member cannot promote", canPromoteToAdmin(member) === false);

check("an admin cannot demote", canDemoteAdmin(admin) === false);
check("the owner can demote", canDemoteAdmin(owner));
check("a member cannot demote", canDemoteAdmin(member) === false);
check(
  "an inactive owner cannot demote",
  canDemoteAdmin(person("inactive", { isAdmin: true, isSuperAdmin: true })) === false,
);

// --- Role change guards -----------------------------------------------------
console.log("\n=== Role change guards ===");
const targetMember = { id: "member", isAdmin: false, isSuperAdmin: false };
const targetAdmin = { id: "admin-2", isAdmin: true, isSuperAdmin: false };
const targetOwner = { id: "owner", isAdmin: true, isSuperAdmin: true };

expectAllows("admin promotes a member", () => assertCanChangeRole(admin, targetMember, true));
expectThrows("admin tries to demote another admin", () =>
  assertCanChangeRole(admin, targetAdmin, false),
);
expectAllows("owner demotes an admin", () => assertCanChangeRole(owner, targetAdmin, false));

// The lockout guards.
expectThrows("nobody can change the owner's role", () =>
  assertCanChangeRole(owner, targetOwner, false),
);
expectThrows("an admin cannot demote the owner", () =>
  assertCanChangeRole(admin, targetOwner, false),
);
expectThrows("an admin cannot change their own role", () =>
  assertCanChangeRole(admin, { id: "admin", isAdmin: true, isSuperAdmin: false }, false),
);
expectThrows("a member cannot promote themselves", () =>
  assertCanChangeRole(member, targetMember, true),
);
expectThrows("a pending admin cannot promote anyone", () =>
  assertCanChangeRole(person("pending", { isAdmin: true, id: "p" }), targetMember, true),
);

// --- Messaging --------------------------------------------------------------
console.log("\n=== Blocked-reason copy ===");
check("approved has no blocked reason", getOrderingBlockedReason(person("approved")) === null);
for (const status of ["pending", "inactive", "rejected"] as AccountStatus[]) {
  const reason = getOrderingBlockedReason(person(status));
  check(
    `${status.padEnd(8)} explains itself in plain language`,
    typeof reason === "string" && reason.length > 20 && !reason.includes("_"),
    String(reason),
  );
}

console.log(`\n${"=".repeat(52)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(52)}\n`);
process.exit(failed > 0 ? 1 : 0);
