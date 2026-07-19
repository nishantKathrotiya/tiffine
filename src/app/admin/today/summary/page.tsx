import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { isActiveAdmin } from "@/lib/auth/permissions";
import { getBadgeCounts } from "@/lib/services/badge-service";
import { getProviderHandoff } from "@/lib/services/day-service";
import { AppShell } from "@/components/app-shell";
import { ProviderHandoff } from "./provider-handoff";
import { formatDayLong, getDateKey } from "@/lib/time";

export const metadata: Metadata = { title: "Provider counts · Tiffine" };

export default async function ProviderSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  if (!isActiveAdmin(viewer)) redirect("/");

  const params = await searchParams;
  const dateKey = params.date ?? getDateKey();

  const [handoff, badges] = await Promise.all([
    getProviderHandoff(viewer, dateKey).catch(() => null),
    getBadgeCounts(viewer),
  ]);

  return (
    <AppShell viewer={viewer} badges={badges}>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <header>
          <h1 className="text-display text-text">Counts for the provider</h1>
          <p className="text-text-muted text-body mt-1">{formatDayLong(dateKey)}</p>
        </header>

        {handoff ? (
          <ProviderHandoff
            dateKey={dateKey}
            dayStatus={handoff.day.status}
            deadlineLabel={handoff.deadlineLabel}
            summary={handoff.summary}
            breakdown={handoff.breakdown}
            message={handoff.message}
            items={handoff.summary.items.map((item) => ({
              name: item.name,
              totalQuantity: item.totalQuantity,
              lineTotalPaise: item.lineTotalPaise,
            }))}
          />
        ) : (
          <p className="text-text-muted text-body">No menu exists for this day yet.</p>
        )}
      </div>
    </AppShell>
  );
}
