import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { isActiveAdmin } from "@/lib/auth/permissions";
import { getPendingCount } from "@/lib/services/people-service";
import { getSettlementRun } from "@/lib/services/settlement-service";
import { AppShell } from "@/components/app-shell";
import { RunDetail } from "./run-detail";
import { publicEnv } from "@/lib/env";
import { formatDayShort } from "@/lib/time";

export const metadata: Metadata = { title: "Settlement · Tiffine" };

export default async function SettlementRunPage({
  params,
}: {
  params: Promise<{ run: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  if (!isActiveAdmin(viewer)) redirect("/");

  const { run: runId } = await params;
  const [detail, pendingCount] = await Promise.all([
    getSettlementRun(viewer, runId).catch(() => null),
    getPendingCount(viewer),
  ]);

  if (!detail) redirect("/admin/payments");

  const periodLabel = `${formatDayShort(String(detail.run.periodStart))} – ${formatDayShort(String(detail.run.periodEnd))}`;

  return (
    <AppShell viewer={viewer} pendingCount={pendingCount}>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <header>
          <h1 className="text-display text-text">Settlement</h1>
          <p className="text-text-muted text-body mt-1">{periodLabel}</p>
        </header>

        <RunDetail
          runId={runId}
          periodLabel={periodLabel}
          totalPaise={detail.run.totalPaise}
          providerBillPaise={detail.run.providerBillPaise}
          reconciliation={detail.reconciliation}
          collectedPaise={detail.collectedPaise}
          outstandingPaise={detail.outstandingPaise}
          dayCount={detail.days.length}
          lines={detail.lines.map((line) => ({
            id: line.id,
            name: line.name,
            totalPaise: line.totalPaise,
            paymentStatus: line.paymentStatus,
          }))}
          upiPayeeVpa={publicEnv.NEXT_PUBLIC_UPI_PAYEE_VPA ?? ""}
          upiPayeeName={publicEnv.NEXT_PUBLIC_UPI_PAYEE_NAME ?? "Tiffine"}
        />
      </div>
    </AppShell>
  );
}
