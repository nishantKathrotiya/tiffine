import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UtensilsCrossed } from "lucide-react";
import { getViewer } from "@/lib/auth/session";
import { canPlaceOrders } from "@/lib/auth/permissions";
import { getPendingCount } from "@/lib/services/people-service";
import { getMyCancellationRequest } from "@/lib/services/cancellation-service";
import { getOrderingContext } from "@/lib/services/order-service";
import { AppShell } from "@/components/app-shell";
import { AccountStatusBanner } from "@/components/account-status-banner";
import { OrderForm } from "./order-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDayLong, isValidDateKey } from "@/lib/time";

export const metadata: Metadata = { title: "Order · Tiffine" };

export default async function OrderDayPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const viewer = await getViewer();

  // The link is shared into WhatsApp, so an unauthenticated tap is the common
  // case. Send them to sign in and back to the same day afterwards.
  if (!viewer) redirect(`/signin?next=/d/${date}`);
  if (!isValidDateKey(date)) redirect("/");

  const [context, pendingCount, cancellation] = await Promise.all([
    getOrderingContext(viewer, date),
    getPendingCount(viewer),
    getMyCancellationRequest(viewer.id, date),
  ]);

  return (
    <AppShell viewer={viewer} pendingCount={pendingCount}>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <header>
          <h1 className="text-display text-text">
            {context?.day.title || "Today's menu"}
          </h1>
          <p className="text-text-muted text-body mt-1">{formatDayLong(date)}</p>
        </header>

        <AccountStatusBanner viewer={viewer} />

        {!context ? (
          <Card>
            <CardHeader title="Menu" action={<StatusPill status="draft" />} />
            <CardBody>
              <EmptyState
                icon={<UtensilsCrossed className="size-8" />}
                title="No menu published for this day"
                description="Once the menu is published you'll be able to place your order here."
              />
            </CardBody>
          </Card>
        ) : (
          <OrderForm
            dateKey={date}
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
        )}
      </div>
    </AppShell>
  );
}
