import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { isActiveAdmin } from "@/lib/auth/permissions";
import { getBadgeCounts } from "@/lib/services/badge-service";
import { getMenuDay } from "@/lib/services/menu-service";
import { getDayBreakdown } from "@/lib/services/day-service";
import { AppShell } from "@/components/app-shell";
import { RepollForm } from "./repoll-form";
import { formatDayLong, getDateKey } from "@/lib/time";

export const metadata: Metadata = { title: "New round · Tiffine" };

export default async function RepollPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  if (!isActiveAdmin(viewer)) redirect("/");

  const params = await searchParams;
  const dateKey = params.date ?? getDateKey();

  const [menu, badges] = await Promise.all([
    getMenuDay(dateKey),
    getBadgeCounts(viewer),
  ]);

  if (!menu) redirect(`/admin/today?date=${dateKey}`);

  const breakdown = await getDayBreakdown(menu.day.id);

  // How many people currently hold each item — shown against every item so
  // Deep can see the blast radius of withdrawing one before he does it.
  const holdersByItem = new Map<string, number>();
  for (const item of menu.items) {
    const count = breakdown.filter(
      (row) => row.status === "active" && row.itemSummary.includes(item.name),
    ).length;
    holdersByItem.set(item.id, count);
  }

  return (
    <AppShell viewer={viewer} badges={badges}>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <header>
          <h1 className="text-display text-text">New round</h1>
          <p className="text-text-muted text-body mt-1">{formatDayLong(dateKey)}</p>
        </header>

        <RepollForm
          dateKey={dateKey}
          currentRound={menu.round?.roundNumber ?? 1}
          items={menu.items.map((item) => ({
            id: item.id,
            name: item.name,
            unitPricePaise: Number(item.unitPricePaise),
            holders: holdersByItem.get(item.id) ?? 0,
          }))}
        />
      </div>
    </AppShell>
  );
}
