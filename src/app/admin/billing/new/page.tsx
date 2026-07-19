import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { isActiveAdmin } from "@/lib/auth/permissions";
import { getPendingCount } from "@/lib/services/people-service";
import { AppShell } from "@/components/app-shell";
import { SettlementBuilder } from "./settlement-builder";
import { getDateKey } from "@/lib/time";

export const metadata: Metadata = { title: "New settlement · Tiffine" };

export default async function NewSettlementPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  if (!isActiveAdmin(viewer)) redirect("/");

  const pendingCount = await getPendingCount(viewer);
  const today = getDateKey();

  return (
    <AppShell viewer={viewer} pendingCount={pendingCount}>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <header>
          <h1 className="text-display text-text">New settlement</h1>
          <p className="text-text-muted text-body mt-1">
            Pick any date range, preview the totals, then commit.
          </p>
        </header>

        <SettlementBuilder
          defaultStart={`${today.slice(0, 7)}-01`}
          defaultEnd={today}
        />
      </div>
    </AppShell>
  );
}
