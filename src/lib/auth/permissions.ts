import type { AccountStatus } from "@/lib/db/schema";
import { AppError, errors } from "@/lib/api/errors";

/**
 * Permission rules — the single source of truth for who may do what.
 *
 * Every route handler and every UI guard imports from here. Duplicating a rule
 * inline is how a screen ends up hiding a button while the endpoint behind it
 * stays open.
 */

export type Viewer = {
  id: string;
  name: string;
  email: string;
  accountStatus: AccountStatus;
  isAdmin: boolean;
  isSuperAdmin: boolean;
};

/**
 * Ordering requires an approved account.
 *
 * `pending` and `inactive` can sign in and read everything, but neither may
 * place, edit, or cancel an order. `rejected` cannot sign in at all.
 */
export function canPlaceOrders(viewer: Viewer): boolean {
  return viewer.accountStatus === "approved";
}

/** Signing in at all. Rejected accounts are refused at the credential check. */
export function canSignIn(status: AccountStatus): boolean {
  return status !== "rejected";
}

/** Read access to dashboards and history — everyone who can sign in. */
export function canViewDashboard(viewer: Viewer): boolean {
  return canSignIn(viewer.accountStatus);
}

/**
 * Admin actions: approving users, publishing menus, running settlements.
 * An inactive account loses admin powers even if the flag is still set, so
 * deactivating someone is a complete revocation.
 */
export function isActiveAdmin(viewer: Viewer): boolean {
  return viewer.isAdmin && viewer.accountStatus === "approved";
}

/** Any admin may grant admin to someone else. */
export function canPromoteToAdmin(viewer: Viewer): boolean {
  return isActiveAdmin(viewer);
}

/**
 * Only the super-admin may revoke admin.
 *
 * Without this asymmetry a mistaken promotion would be irreversible, and two
 * admins could demote each other into a lockout.
 */
export function canDemoteAdmin(viewer: Viewer): boolean {
  return viewer.isSuperAdmin && viewer.accountStatus === "approved";
}

/** The super-admin flag is never editable through the application. */
export function canModifySuperAdmin(): boolean {
  return false;
}

/** Explanatory copy for a viewer who cannot currently order. */
export function getOrderingBlockedReason(viewer: Viewer): string | null {
  switch (viewer.accountStatus) {
    case "approved":
      return null;
    case "pending":
      return "Your account is waiting for approval. You can look around, but you'll be able to place orders once an admin approves you.";
    case "inactive":
      return "Your account has been deactivated, so you can't place new orders. Your past orders and payments are still here.";
    case "rejected":
      return "Your account request was declined.";
  }
}

// ---------------------------------------------------------------------------
// Assertions — throw the typed error a route handler should return
// ---------------------------------------------------------------------------

export function assertCanPlaceOrders(viewer: Viewer): void {
  if (canPlaceOrders(viewer)) return;
  throw new AppError("FORBIDDEN", getOrderingBlockedReason(viewer) ?? "You can't place orders.");
}

export function assertIsAdmin(viewer: Viewer): void {
  if (isActiveAdmin(viewer)) return;
  throw errors.forbidden("manage this");
}

export function assertCanDemote(viewer: Viewer): void {
  if (canDemoteAdmin(viewer)) return;
  throw new AppError(
    "FORBIDDEN",
    "Only the group owner can remove admin access. Ask them if this needs changing.",
  );
}

/**
 * Guards a role change end to end, including the cases that would otherwise
 * strand the group without an owner.
 */
export function assertCanChangeRole(
  viewer: Viewer,
  target: { id: string; isAdmin: boolean; isSuperAdmin: boolean },
  nextIsAdmin: boolean,
): void {
  if (target.isSuperAdmin) {
    throw new AppError("FORBIDDEN", "The group owner's role can't be changed.");
  }
  if (viewer.id === target.id) {
    throw new AppError("FORBIDDEN", "You can't change your own role.");
  }
  if (nextIsAdmin) {
    if (!canPromoteToAdmin(viewer)) throw errors.forbidden("promote people");
  } else {
    assertCanDemote(viewer);
  }
}
