import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { getViewer } from "@/lib/auth/session";
import { getPendingCount } from "@/lib/services/people-service";
import { getOrderHistory, getPersonRunningTotal } from "@/lib/services/order-service";
import { AppShell } from "@/components/app-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import { Money } from "@/components/ui/money";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDayShort, getDateKey } from "@/lib/time";

export const metadata: Metadata = { title: "My orders · Tiffine" };

export default async function MyOrdersPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin?next=/me");

  // Month-to-date, so nobody is surprised by their bill at settlement.
  const today = getDateKey();
  const monthStart = `${today.slice(0, 7)}-01`;

  const [history, running, pendingCount] = await Promise.all([
    getOrderHistory(viewer.id),
    getPersonRunningTotal(viewer.id, monthStart, today),
    getPendingCount(viewer),
  ]);

  return (
    <AppShell viewer={viewer} pendingCount={pendingCount}>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <header>
          <h1 className="text-display text-text">My orders</h1>
          <p className="text-text-muted text-body mt-1">
            Everything you&rsquo;ve ordered, and what it comes to.
          </p>
        </header>

        <Card>
          <CardHeader
            title="This month so far"
            // State the window explicitly: the total covers days up to today,
            // so an order placed for a future date appears in History below
            // without being counted here. Without the dates that reads as a
            // bug rather than a boundary.
            description={`${formatDayShort(monthStart)} – ${formatDayShort(today)}`}
          />
          <CardBody className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-text-muted text-body">Days ordered</span>
              <span data-numeric className="text-body text-text font-mono">
                {running.dayCount}
              </span>
            </div>
            <div className="border-line flex items-center justify-between border-t pt-3">
              <span className="text-text-muted text-body">Running total</span>
              <Money paise={running.totalPaise} variant="total" />
            </div>
            <p className="text-text-subtle text-caption">
              Covers days up to today. Orders for upcoming days show in your history below and
              are counted once that day arrives. The final amount is confirmed when an admin
              runs the settlement.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="History" description={`${history.length} day${history.length === 1 ? "" : "s"}`} />

          {history.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={<CalendarDays className="size-8" />}
                title="No orders yet"
                description="Once you place your first order it'll show up here, along with a running total."
              />
            </CardBody>
          ) : (
            <ul className="divide-line divide-y">
              {history.map((entry) => (
                <li key={entry.orderId} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/d/${entry.dateKey}`}
                          className="text-body text-text font-medium underline-offset-2 hover:underline"
                        >
                          {formatDayShort(entry.dateKey)}
                        </Link>
                        {entry.status === "cancelled" && <StatusPill status="cancelled" />}
                      </div>
                      {entry.title && (
                        <p className="text-text-subtle text-caption mt-0.5">{entry.title}</p>
                      )}
                      <p className="text-text-muted text-label mt-1 wrap-break-word">
                        {entry.itemSummary || "No items"}
                      </p>
                    </div>
                    {/* A cancelled day is struck through and shown at zero, so
                        it reads as "not charged" rather than just "cancelled". */}
                    <Money
                      paise={entry.status === "cancelled" ? 0 : entry.totalPaise}
                      variant={entry.status === "cancelled" ? "muted" : "default"}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
