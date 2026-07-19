import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { getPendingCount } from "@/lib/services/people-service";
import { AppShell } from "@/components/app-shell";
import { NotificationSettings } from "@/components/notification-settings";
import { AccountStatusBanner } from "@/components/account-status-banner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { publicEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Settings · Tiffine" };

export default async function SettingsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin?next=/settings");

  const pendingCount = await getPendingCount(viewer);

  return (
    <AppShell viewer={viewer} pendingCount={pendingCount}>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <header>
          <h1 className="text-display text-text">Settings</h1>
          <p className="text-text-muted text-body mt-1">Your account and notifications.</p>
        </header>

        <AccountStatusBanner viewer={viewer} />

        <NotificationSettings
          vapidPublicKey={publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""}
        />

        <Card>
          <CardHeader title="Account" />
          <CardBody className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-text-muted text-body">Name</span>
              <span className="text-text text-body">{viewer.name}</span>
            </div>
            <div className="border-line flex items-center justify-between gap-3 border-t pt-2">
              <span className="text-text-muted text-body">Email</span>
              <span className="text-text text-body break-all">{viewer.email}</span>
            </div>
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
