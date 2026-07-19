import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Wallet } from "lucide-react";
import { getViewer } from "@/lib/auth/session";
import { isActiveAdmin } from "@/lib/auth/permissions";
import { getPendingCount } from "@/lib/services/people-service";
import { getPaymentsOverview, listSettlementRuns } from "@/lib/services/settlement-service";
import { AppShell } from "@/components/app-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import { Money } from "@/components/ui/money";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDayShort } from "@/lib/time";

export const metadata: Metadata = { title: "Payments · Tiffine" };

export default async function PaymentsDashboardPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  if (!isActiveAdmin(viewer)) redirect("/");

  const [overview, runs, pendingCount] = await Promise.all([
    getPaymentsOverview(viewer),
    listSettlementRuns(viewer),
    getPendingCount(viewer),
  ]);

  return (
    <AppShell viewer={viewer} pendingCount={pendingCount}>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-display text-text">Payments</h1>
            <p className="text-text-muted text-body mt-1">
              What&rsquo;s been collected, and what&rsquo;s still owed.
            </p>
          </div>
          <Link
            href="/admin/billing/new"
            className="bg-primary text-text-on-primary hover:bg-primary-hover inline-flex min-h-11 items-center gap-2 rounded-md px-4 text-body font-medium transition-colors"
          >
            <Plus className="size-4" aria-hidden />
            New settlement
          </Link>
        </header>

        <Card>
          <CardHeader title="Across all settlements" />
          <CardBody className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-text-muted text-body">Collected</span>
              <Money paise={overview.collectedPaise} />
            </div>
            <div className="border-line flex items-center justify-between border-t pt-3">
              <span className="text-text-muted text-body">Outstanding</span>
              <Money paise={overview.outstandingPaise} variant="total" />
            </div>
            {overview.waivedPaise > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-text-muted text-body">Waived</span>
                <Money paise={overview.waivedPaise} variant="muted" />
              </div>
            )}
          </CardBody>
        </Card>

        {overview.byPerson.length > 0 && (
          <Card>
            <CardHeader title="Still to collect" description={`${overview.byPerson.length} people`} />
            <ul className="divide-line divide-y">
              {overview.byPerson.map((person) => (
                <li
                  key={person.personId}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <span className="text-body text-text min-w-0 flex-1 wrap-break-word">
                    {person.name}
                  </span>
                  <Money paise={person.outstandingPaise} />
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader title="Settlement history" description={`${runs.length} run${runs.length === 1 ? "" : "s"}`} />
          {runs.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={<Wallet className="size-8" />}
                title="No settlements yet"
                description="Pick a date range and commit a run to generate per-person amounts."
              />
            </CardBody>
          ) : (
            <ul className="divide-line divide-y">
              {runs.map((run) => (
                <li key={run.id}>
                  <Link
                    href={`/admin/billing/${run.id}`}
                    className="hover:bg-surface-raised flex items-start justify-between gap-3 px-5 py-4 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-body text-text font-medium">
                        {formatDayShort(String(run.periodStart))} –{" "}
                        {formatDayShort(String(run.periodEnd))}
                      </p>
                      <p className="text-text-muted text-caption mt-0.5">
                        {run.personCount} {run.personCount === 1 ? "person" : "people"}
                        {run.pendingPaise === 0 ? " · fully paid" : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <Money paise={run.totalPaise} />
                      <div className="mt-1">
                        <StatusPill status={run.pendingPaise === 0 ? "paid" : "unpaid"} />
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
