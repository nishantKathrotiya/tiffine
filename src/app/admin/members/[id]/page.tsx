import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { isActiveAdmin } from "@/lib/auth/permissions";
import { getPendingCount } from "@/lib/services/people-service";
import { getMemberDetail, getMemberOrderBounds } from "@/lib/services/member-service";
import { AppShell } from "@/components/app-shell";
import { MemberOrders } from "./member-orders";
import { isValidDateKey } from "@/lib/time";

export const metadata: Metadata = { title: "Member · Tiffine" };

export default async function MemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  if (!isActiveAdmin(viewer)) redirect("/");

  const { id } = await params;
  const { from, to } = await searchParams;

  // Ignore malformed dates rather than erroring — a hand-edited URL should
  // fall back to "everything", not break the page.
  const fromDateKey = from && isValidDateKey(from) ? from : undefined;
  const toDateKey = to && isValidDateKey(to) ? to : undefined;

  const [detail, bounds, pendingCount] = await Promise.all([
    getMemberDetail(viewer, id, { fromDateKey, toDateKey }).catch(() => null),
    getMemberOrderBounds(viewer, id).catch(() => ({ first: null, last: null })),
    getPendingCount(viewer),
  ]);

  if (!detail) redirect("/admin/members");

  return (
    <AppShell viewer={viewer} pendingCount={pendingCount}>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <MemberOrders
          memberId={id}
          person={detail.person}
          orders={detail.orders.map((order) => ({
            orderId: order.orderId,
            dateKey: String(order.dateKey),
            title: order.title,
            status: order.status,
            itemSummary: order.itemSummary,
            totalPaise: order.totalPaise,
          }))}
          rangeTotalPaise={detail.rangeTotalPaise}
          rangeDayCount={detail.rangeDayCount}
          outstandingPaise={detail.outstandingPaise}
          payments={detail.payments}
          from={fromDateKey ?? ""}
          to={toDateKey ?? ""}
          bounds={bounds}
        />
      </div>
    </AppShell>
  );
}
