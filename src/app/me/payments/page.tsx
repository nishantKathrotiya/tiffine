import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wallet } from "lucide-react";
import { getViewer } from "@/lib/auth/session";
import { getPendingCount } from "@/lib/services/people-service";
import { getMyPayments } from "@/lib/services/settlement-service";
import { AppShell } from "@/components/app-shell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import { Money } from "@/components/ui/money";
import { StatusPill } from "@/components/ui/status-pill";
import { sumPaise } from "@/lib/money";
import { formatDayShort } from "@/lib/time";

export const metadata: Metadata = { title: "My payments · Tiffine" };

export default async function MyPaymentsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin?next=/me/payments");

  const [payments, pendingCount] = await Promise.all([
    getMyPayments(viewer.id),
    getPendingCount(viewer),
  ]);

  const outstanding = sumPaise(
    payments.filter((p) => p.paymentStatus === "pending").map((p) => p.totalPaise),
  );

  return (
    <AppShell viewer={viewer} pendingCount={pendingCount}>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <header>
          <h1 className="text-display text-text">My payments</h1>
          <p className="text-text-muted text-body mt-1">What you owe, and what you&rsquo;ve paid.</p>
        </header>

        <Card>
          <CardHeader title="Outstanding" />
          <CardBody className="flex items-center justify-between">
            <span className="text-text-muted text-body">
              {outstanding === 0 ? "You're all settled up" : "Total you owe"}
            </span>
            <Money paise={outstanding} variant="total" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="By period" description={`${payments.length} settlement${payments.length === 1 ? "" : "s"}`} />
          {payments.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={<Wallet className="size-8" />}
                title="Nothing billed yet"
                description="Once an admin runs a settlement, your amount for that period will appear here."
              />
            </CardBody>
          ) : (
            <ul className="divide-line divide-y">
              {payments.map((payment) => (
                <li key={payment.lineId} className="flex items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-body text-text font-medium">
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
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
