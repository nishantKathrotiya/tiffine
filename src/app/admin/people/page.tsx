import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { getBadgeCounts } from "@/lib/services/badge-service";
import { isActiveAdmin } from "@/lib/auth/permissions";
import { getPendingCount, listPeople } from "@/lib/services/people-service";
import { AppShell } from "@/components/app-shell";
import { PeopleTable } from "./people-table";
import { Card, CardHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "People · Tiffine" };

export default async function AdminPeoplePage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  // Authorization is checked here and again in every service call — the page
  // being unreachable in the nav is not a control.
  if (!isActiveAdmin(viewer)) redirect("/");

  const [people, badges] = await Promise.all([
    listPeople(viewer),
    getBadgeCounts(viewer),
  ]);

  return (
    <AppShell viewer={viewer} badges={badges}>
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <header>
          <h1 className="text-display text-text">People</h1>
          <p className="text-text-muted text-body mt-1">
            Approve new members, manage access, and merge duplicate accounts.
          </p>
        </header>

        <Card>
          <CardHeader
            title="Group members"
            description={
              badges.pendingMembers > 0
                ? `${badges.pendingMembers} waiting for approval`
                : "Everyone is up to date"
            }
          />
          <PeopleTable viewer={viewer} people={people} />
        </Card>
      </div>
    </AppShell>
  );
}
