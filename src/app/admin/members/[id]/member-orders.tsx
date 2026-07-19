"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import { Money } from "@/components/ui/money";
import { StatusPill, type StatusKind } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { formatDayShort, getDateKey } from "@/lib/time";

type OrderRow = {
  orderId: string;
  dateKey: string;
  title: string | null;
  status: string;
  itemSummary: string;
  totalPaise: number;
};

type Payment = {
  runId: string;
  periodStart: string;
  periodEnd: string;
  totalPaise: number;
  paymentStatus: string;
};

const STATUS_PILL: Record<string, StatusKind> = {
  pending: "pending",
  approved: "approved",
  inactive: "not_ordered",
  rejected: "rejected",
};

/**
 * One member's order history, filterable by date range.
 *
 * The range lives in the URL and is applied in SQL, so the totals shown are
 * always the totals for what's on screen — and a filtered view can be shared
 * or reloaded when someone queries their bill.
 */
export function MemberOrders({
  memberId,
  person,
  orders,
  rangeTotalPaise,
  rangeDayCount,
  outstandingPaise,
  payments,
  from,
  to,
  bounds,
}: {
  memberId: string;
  person: {
    name: string;
    email: string;
    accountStatus: string;
    isAdmin: boolean;
    isSuperAdmin: boolean;
  };
  orders: OrderRow[];
  rangeTotalPaise: number;
  rangeDayCount: number;
  outstandingPaise: number;
  payments: Payment[];
  from: string;
  to: string;
  bounds: { first: string | null; last: string | null };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function applyRange(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams();
    if (nextFrom) params.set("from", nextFrom);
    if (nextTo) params.set("to", nextTo);
    startTransition(() => {
      router.replace(
        params.toString()
          ? `/admin/members/${memberId}?${params}`
          : `/admin/members/${memberId}`,
      );
    });
  }

  /** Common ranges, since typing two dates for "this month" is tedious. */
  function applyPreset(preset: "month" | "prev-month" | "all") {
    const today = getDateKey();

    if (preset === "all") return applyRange("", "");

    if (preset === "month") {
      return applyRange(`${today.slice(0, 7)}-01`, today);
    }

    const [year, month] = today.split("-").map(Number);
    const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
    const pad = (n: number) => String(n).padStart(2, "0");
    // Day 0 of the next month is the last day of this one — avoids a
    // month-length table and gets February right.
    const lastDay = new Date(Date.UTC(prev.y, prev.m, 0)).getUTCDate();
    applyRange(`${prev.y}-${pad(prev.m)}-01`, `${prev.y}-${pad(prev.m)}-${pad(lastDay)}`);
  }

  const hasRange = Boolean(from || to);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/admin/members"
          className="text-text-muted hover:text-text inline-flex items-center gap-1.5 text-label"
        >
          <ArrowLeft className="size-4" aria-hidden />
          All members
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-display text-text">{person.name}</h1>
          <StatusPill status={STATUS_PILL[person.accountStatus] ?? "not_ordered"} />
          {person.isSuperAdmin ? (
            <StatusPill status="settled" label="Owner" />
          ) : person.isAdmin ? (
            <StatusPill status="sent_to_provider" label="Admin" />
          ) : null}
        </div>
        <p className="text-text-muted text-body mt-1 break-all">{person.email}</p>
      </div>

      <Card>
        <CardHeader title="Date range" description="Filter the orders below" />
        <CardBody className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex-1">
              <span className="text-label text-text mb-1.5 block">From</span>
              <input
                type="date"
                value={from}
                min={bounds.first ?? undefined}
                max={to || bounds.last || undefined}
                onChange={(event) => applyRange(event.target.value, to)}
                className="border-line-strong bg-surface text-text min-h-11 w-full rounded-md border px-3 text-body"
              />
            </label>
            <label className="flex-1">
              <span className="text-label text-text mb-1.5 block">To</span>
              <input
                type="date"
                value={to}
                min={from || bounds.first || undefined}
                max={bounds.last ?? undefined}
                onChange={(event) => applyRange(from, event.target.value)}
                className="border-line-strong bg-surface text-text min-h-11 w-full rounded-md border px-3 text-body"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => applyPreset("month")}>
              This month
            </Button>
            <Button size="sm" variant="secondary" onClick={() => applyPreset("prev-month")}>
              Last month
            </Button>
            {hasRange && (
              <Button size="sm" variant="ghost" onClick={() => applyPreset("all")}>
                Clear
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={hasRange ? "Total for this range" : "Total, all time"}
          description={isPending ? "Updating…" : undefined}
        />
        <CardBody className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-text-muted text-body">Days ordered</span>
            <span data-numeric className="text-body text-text font-mono">
              {rangeDayCount}
            </span>
          </div>
          <div className="border-line flex items-center justify-between border-t pt-3">
            <span className="text-text-muted text-body">Ordered value</span>
            <Money paise={rangeTotalPaise} variant="total" />
          </div>
          {outstandingPaise > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-text-muted text-body">Currently unpaid</span>
              <Money paise={outstandingPaise} />
            </div>
          )}
          {/* Named explicitly: the range total is what they ordered, which is
              not the same as what has been billed and is still owed. */}
          <p className="text-text-subtle text-caption">
            Ordered value covers the range above. Unpaid is what&rsquo;s owed across all
            committed settlements.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Orders"
          description={`${orders.length} day${orders.length === 1 ? "" : "s"}`}
        />

        {orders.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<CalendarDays className="size-8" />}
              title={hasRange ? "No orders in this range" : "No orders yet"}
              description={
                hasRange
                  ? "Widen the dates, or clear the filter to see everything."
                  : "Orders appear here once this person starts ordering."
              }
            />
          </CardBody>
        ) : (
          <ul className="divide-line divide-y">
            {orders.map((order) => (
              <li key={order.orderId} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/d/${order.dateKey}`}
                        className="text-body text-text font-medium underline-offset-2 hover:underline"
                      >
                        {formatDayShort(order.dateKey)}
                      </Link>
                      {order.status === "cancelled" && <StatusPill status="cancelled" />}
                    </div>
                    {order.title && (
                      <p className="text-text-subtle text-caption mt-0.5">{order.title}</p>
                    )}
                    <p className="text-text-muted text-label mt-1 wrap-break-word">
                      {order.itemSummary || "—"}
                    </p>
                  </div>
                  {/* Cancelled days show ₹0 so the list reads as "not charged"
                      rather than just "cancelled". */}
                  <Money
                    paise={order.status === "cancelled" ? 0 : order.totalPaise}
                    variant={order.status === "cancelled" ? "muted" : "default"}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {payments.length > 0 && (
        <Card>
          <CardHeader title="Settlements" description={`${payments.length} run${payments.length === 1 ? "" : "s"}`} />
          <ul className="divide-line divide-y">
            {payments.map((payment) => (
              <li key={payment.runId}>
                <Link
                  href={`/admin/billing/${payment.runId}`}
                  className="hover:bg-surface-raised flex items-center justify-between gap-3 px-5 py-3 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-body text-text">
                      {formatDayShort(payment.periodStart)} – {formatDayShort(payment.periodEnd)}
                    </p>
                    <div className="mt-1">
                      <StatusPill
                        status={
                          payment.paymentStatus === "paid"
                            ? "paid"
                            : payment.paymentStatus === "waived"
                              ? "waived"
                              : "unpaid"
                        }
                      />
                    </div>
                  </div>
                  <Money paise={payment.totalPaise} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
