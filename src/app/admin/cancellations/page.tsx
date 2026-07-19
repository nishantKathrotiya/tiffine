import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { isActiveAdmin } from "@/lib/auth/permissions";
import { getPendingCount } from "@/lib/services/people-service";
import { listPendingCancellations } from "@/lib/services/cancellation-service";
import { AppShell } from "@/components/app-shell";
import { CancellationQueue } from "./cancellation-queue";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";

export const metadata: Metadata = { title: "Cancellations · Tiffine" };

export default async function CancellationsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  if (!isActiveAdmin(viewer)) redirect("/");

  const [requests, pendingCount] = await Promise.all([
    listPendingCancellations(viewer),
    getPendingCount(viewer),
  ]);

  return (
    <AppShell viewer={viewer} pendingCount={pendingCount + requests.length}>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <header>
          <h1 className="text-display text-text">Cancellations</h1>
          <p className="text-text-muted text-body mt-1">
            Requests made after ordering closed.
          </p>
        </header>

        {requests.length === 0 ? (
          <Card>
            <CardHeader title="Nothing waiting" />
            <CardBody>
              <EmptyState
                title="No cancellation requests"
                description="When someone asks to cancel after the deadline, it'll appear here for you to approve or decline."
              />
            </CardBody>
          </Card>
        ) : (
          <CancellationQueue
            requests={requests.map((request) => ({
              ...request,
              createdAt: request.createdAt.toISOString(),
              dateKey: String(request.dateKey),
            }))}
          />
        )}
      </div>
    </AppShell>
  );
}
