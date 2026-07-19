import { redirect } from "next/navigation";
import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";
import { getViewer } from "@/lib/auth/session";
import { getBadgeCounts } from "@/lib/services/badge-service";
import { canPlaceOrders, isActiveAdmin } from "@/lib/auth/permissions";
import { getMyCancellationRequest } from "@/lib/services/cancellation-service";
import { getOrderingContext, getPersonRunningTotal } from "@/lib/services/order-service";
import { AppShell } from "@/components/app-shell";
import { AccountStatusBanner } from "@/components/account-status-banner";
import { OrderForm } from "./d/[date]/order-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import { Money } from "@/components/ui/money";
import { formatDayLong, getDateKey } from "@/lib/time";

export default async function HomePage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");

  const today = getDateKey();
  const monthStart = `${today.slice(0, 7)}-01`;

  const [context, running, badges, cancellation] = await Promise.all([
    getOrderingContext(viewer, today),
    getPersonRunningTotal(viewer.id, monthStart, today),
    getBadgeCounts(viewer),
    getMyCancellationRequest(viewer.id, today),
  ]);

  return (
    <AppShell viewer={viewer} badges={badges}>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <header>
          <h1 className="text-display text-text">
            {context?.day.title || "Today"}
          </h1>
          <p className="text-text-muted text-body mt-1">{formatDayLong(today)}</p>
        </header>

        <AccountStatusBanner viewer={viewer} />

        {context ? (
          <OrderForm
            dateKey={today}
            items={context.items.map((item) => ({
              id: item.id,
              name: item.name,
              unitPricePaise: Number(item.unitPricePaise),
            }))}
            existingLines={
              context.existing?.lines.map((line) => ({
                menuItemId: line.menuItemId,
                quantity: line.quantity,
              })) ?? []
            }
            deadlineAt={context.round.deadlineAt.toISOString()}
            isOpen={context.isOpen}
            canOrder={canPlaceOrders(viewer)}
            dayStatus={context.day.status}
            existingCancellation={cancellation}
          />
        ) : (
          <Card>
            <CardHeader title="Today's order" />
            <CardBody>
              <EmptyState
                icon={<UtensilsCrossed className="size-8" />}
                title="No menu published yet"
                description={
                  isActiveAdmin(viewer)
                    ? "Add today's items and publish so the group can order."
                    : "Once today's menu is published, it'll show up here."
                }
                action={
                  isActiveAdmin(viewer) ? (
                    // A link styled as a button: navigation should stay a real
                    // anchor so it opens in a new tab and is keyboard-navigable.
                    <Link
                      href="/admin/today"
                      className="bg-primary text-text-on-primary hover:bg-primary-hover inline-flex min-h-11 items-center justify-center rounded-md px-4 text-body font-medium transition-colors"
                    >
                      Set up today&rsquo;s menu
                    </Link>
                  ) : undefined
                }
              />
            </CardBody>
          </Card>
        )}

        {running.dayCount > 0 && (
          <Card>
            <CardBody className="flex items-center justify-between">
              <div>
                <p className="text-text-muted text-body">This month so far</p>
                <p className="text-text-subtle text-caption mt-0.5">
                  {running.dayCount} day{running.dayCount === 1 ? "" : "s"} ordered
                </p>
              </div>
              <Money paise={running.totalPaise} variant="total" />
            </CardBody>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
