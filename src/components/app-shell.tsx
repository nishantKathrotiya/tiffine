import Link from "next/link";
import {
  Ban,
  CalendarDays,
  ClipboardList,
  Home,
  Settings,
  UtensilsCrossed,
  UserSearch,
  Users,
  Wallet,
} from "lucide-react";
import type { Viewer } from "@/lib/auth/permissions";
import { isActiveAdmin } from "@/lib/auth/permissions";
import { SignOutButton } from "./sign-out-button";
import { cn } from "@/lib/cn";
import { NO_BADGES, type BadgeCounts } from "@/lib/services/badge-service";

/**
 * Shared chrome: bottom nav on phones, sidebar on desktop.
 *
 * Admin and member pages use the same shell so the app reads as one product
 * rather than two.
 */

type NavItem = { href: string; label: string; Icon: typeof Home; adminOnly?: boolean };

/**
 * Sidebar order follows the daily admin workflow: publish the menu, send the
 * counts, handle cancellations, then billing — with personal pages after.
 *
 * Non-admins see only the entries without `adminOnly`, which stay in the same
 * relative order (Today, History, Payments, People, Settings).
 */
const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Today", Icon: Home },
  { href: "/admin/today", label: "Menu", Icon: UtensilsCrossed, adminOnly: true },
  {
    href: "/admin/today/summary",
    label: "Provider counts",
    Icon: ClipboardList,
    adminOnly: true,
  },
  { href: "/admin/cancellations", label: "Cancels", Icon: Ban, adminOnly: true },
  { href: "/admin/payments", label: "Billing", Icon: Wallet, adminOnly: true },
  { href: "/me", label: "History", Icon: CalendarDays },
  { href: "/me/payments", label: "Payments", Icon: Wallet },
  { href: "/admin/members", label: "Members", Icon: UserSearch, adminOnly: true },
  { href: "/admin/people", label: "People", Icon: Users, adminOnly: true },
  { href: "/settings", label: "Settings", Icon: Settings },
];

/**
 * Mobile shows at most four tabs — six at 390px cramps the labels to the point
 * of being unreadable. Admin destinations collapse behind one "Admin" tab and
 * stay fully listed in the desktop sidebar.
 */
const MOBILE_ADMIN_TAB: NavItem = {
  href: "/admin/today",
  label: "Admin",
  Icon: UtensilsCrossed,
  adminOnly: true,
};

export function AppShell({
  viewer,
  badges = NO_BADGES,
  children,
}: {
  viewer: Viewer;
  /** Approval and cancellation counts, so neither queue goes unnoticed. */
  badges?: BadgeCounts;
  children: React.ReactNode;
}) {
  const isAdmin = isActiveAdmin(viewer);
  // Sidebar gets every destination; the bottom bar gets a condensed set.
  const sidebarItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
  const mobileItems = [
    ...NAV_ITEMS.filter((item) => !item.adminOnly && item.href !== "/settings"),
    ...(isAdmin ? [MOBILE_ADMIN_TAB] : []),
  ];

  return (
    /**
     * On desktop the shell is pinned to the viewport (`md:h-dvh`) rather than
     * growing with the page. The sidebar then always spans exactly the screen
     * height and never scrolls; only the main column does.
     *
     * `min-h-dvh` on mobile keeps the normal page-scroll behaviour, where the
     * bottom nav is fixed and the document scrolls underneath it.
     */
    <div className="flex min-h-dvh flex-col md:h-dvh md:flex-row md:overflow-hidden">
      {/* Desktop sidebar — fixed height, own scroll only if the nav overflows */}
      <aside className="border-line bg-surface hidden w-60 shrink-0 flex-col border-r md:flex md:h-dvh">
        <div className="border-line border-b px-5 py-4">
          <p className="text-title text-text">Tiffine</p>
          <p className="text-caption text-text-muted mt-0.5 truncate">{viewer.name}</p>
        </div>

        {/* Scrolls internally only if the nav list outgrows a short screen —
            the header and sign-out stay pinned either way. */}
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
          {sidebarItems.map((item) => (
            <NavLink key={item.href} item={item} badge={badgeFor(item, badges)} />
          ))}
        </nav>

        <div className="border-line shrink-0 border-t p-3">
          <SignOutButton />
        </div>
      </aside>

      {/* min-h-0 is required: without it a flex child refuses to shrink below
          its content, and the main column would push the page taller instead
          of scrolling inside its own box. */}
      <div className="flex min-w-0 flex-1 flex-col md:min-h-0">
        {/* Mobile header */}
        <header className="border-line bg-surface flex items-center justify-between border-b px-4 py-3 md:hidden">
          <span className="text-title text-text">Tiffine</span>
          <div className="flex items-center gap-1">
            {/* Settings isn't a bottom tab (four is the limit at 390px), so it
                lives here alongside sign-out. */}
            <Link
              href="/settings"
              aria-label="Settings"
              className="text-text-muted hover:text-text active:bg-surface-raised flex size-11 items-center justify-center rounded-md transition-colors"
            >
              <Settings className="size-5" aria-hidden />
            </Link>
            <SignOutButton compact />
          </div>
        </header>

        {/*
         * The scroll container on desktop: `overflow-y-auto` keeps scrolling
         * inside this column so the sidebar stays put.
         *
         * Bottom padding clears the fixed mobile nav (56px) plus the iOS home
         * indicator. It is applied via a CSS variable that md: resets to 0 —
         * an inline style would apply at every width and leave a phantom gap
         * on desktop, where there is no bottom nav.
         */}
        <main
          className={cn(
            "min-w-0 flex-1 px-4 py-6 md:px-8 md:pb-8",
            "md:min-h-0 md:overflow-y-auto",
            "pb-(--mobile-nav-clearance) md:pb-8",
          )}
          style={
            {
              "--mobile-nav-clearance":
                "calc(56px + env(safe-area-inset-bottom, 0px) + 24px)",
            } as React.CSSProperties
          }
        >
          {children}
        </main>
      </div>

      {/* Mobile bottom nav. Opaque and above content — a translucent bar let
          list rows show through and read as overlapping text. */}
      <nav className="border-line bg-surface pb-safe fixed inset-x-0 bottom-0 z-30 flex border-t md:hidden">
        {mobileItems.map((item) => (
          <MobileNavLink key={item.href} item={item} badge={badgeFor(item, badges)} />
        ))}
      </nav>
    </div>
  );
}

/**
 * Which nav entry shows which count.
 *
 * The condensed mobile "Admin" tab stands in for every admin page, so it
 * carries the SUM — otherwise a pending signup or cancellation would be
 * invisible on a phone, where those pages aren't tabs of their own.
 */
function badgeFor(item: NavItem, badges: BadgeCounts): number {
  if (item.label === "Admin") return badges.pendingMembers + badges.pendingCancellations;
  if (item.href === "/admin/people") return badges.pendingMembers;
  if (item.href === "/admin/cancellations") return badges.pendingCancellations;
  return 0;
}

function NavLink({ item, badge }: { item: NavItem; badge: number }) {
  return (
    <Link
      href={item.href}
      className={cn(
        "text-body text-text-muted hover:bg-surface-raised hover:text-text",
        "flex min-h-11 items-center gap-3 rounded-md px-3 transition-colors",
      )}
    >
      <item.Icon className="size-5 shrink-0" aria-hidden />
      <span className="flex-1">{item.label}</span>
      {badge > 0 && <Badge count={badge} />}
    </Link>
  );
}

function MobileNavLink({ item, badge }: { item: NavItem; badge: number }) {
  return (
    <Link
      href={item.href}
      className="text-text-muted active:bg-surface-raised relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1"
    >
      <span className="relative">
        <item.Icon className="size-5" aria-hidden />
        {badge > 0 && (
          <span className="absolute -right-2 -top-1">
            <Badge count={badge} />
          </span>
        )}
      </span>
      <span className="text-caption">{item.label}</span>
    </Link>
  );
}

function Badge({ count }: { count: number }) {
  return (
    <span
      className="bg-primary text-text-on-primary inline-flex min-w-4.5 items-center justify-center rounded-full px-1.5 py-0.5 text-caption font-medium"
      aria-label={`${count} waiting`}
    >
      {count}
    </span>
  );
}
