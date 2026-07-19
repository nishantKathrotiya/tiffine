import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { isActiveAdmin } from "@/lib/auth/permissions";
import { getBadgeCounts } from "@/lib/services/badge-service";
import { getMenuDay, getRecentItems } from "@/lib/services/menu-service";
import { AppShell } from "@/components/app-shell";
import { MenuBuilder } from "./menu-builder";
import { formatDayLong, getDateKey } from "@/lib/time";

export const metadata: Metadata = { title: "Today's menu · Tiffine" };

export default async function AdminTodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  if (!isActiveAdmin(viewer)) redirect("/");

  const params = await searchParams;
  const dateKey = params.date ?? getDateKey();

  const [existing, recentItems, badges] = await Promise.all([
    getMenuDay(dateKey),
    getRecentItems(),
    getBadgeCounts(viewer),
  ]);

  return (
    <AppShell viewer={viewer} badges={badges}>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <header>
          <h1 className="text-display text-text">Today&rsquo;s menu</h1>
          <p className="text-text-muted text-body mt-1">{formatDayLong(dateKey)}</p>
        </header>

        {/* On phones the bottom bar collapses to a single "Admin" tab that
            lands here, so the other admin screens need reachable links. */}
        <nav className="flex flex-wrap gap-2 md:hidden" aria-label="Admin sections">
          {[
            { href: `/admin/today/summary?date=${dateKey}`, label: "Provider counts" },
            { href: "/admin/cancellations", label: "Cancellations" },
            { href: "/admin/payments", label: "Billing" },
            { href: "/admin/people", label: "People" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="border-line-strong bg-surface text-text hover:bg-surface-raised inline-flex min-h-9 items-center rounded-full border px-3 text-label transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <MenuBuilder
          dateKey={dateKey}
          recentItems={recentItems}
          existing={
            existing
              ? {
                  title: existing.day.title ?? "",
                  status: existing.day.status,
                  deadlineAt: existing.day.deadlineAt?.toISOString() ?? null,
                  orderCount: existing.orderCount,
                  items: existing.items.map((item) => ({
                    name: item.name,
                    unitPricePaise: Number(item.unitPricePaise),
                  })),
                }
              : null
          }
        />
      </div>
    </AppShell>
  );
}
