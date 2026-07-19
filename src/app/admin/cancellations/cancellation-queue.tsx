"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { apiPost } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { formatDayShort } from "@/lib/time";

type Request = {
  id: string;
  reason: string | null;
  createdAt: string;
  personName: string;
  personEmail: string;
  dateKey: string;
  dayTitle: string | null;
  orderTotalPaise: number;
  itemSummary: string;
};

/**
 * Approve or decline cancellation requests.
 *
 * The consequence of each choice is spelled out on the buttons themselves —
 * approving means the group absorbs nothing and the person isn't billed;
 * declining means they get the tiffin and pay for it. Deep shouldn't have to
 * remember which is which.
 */
export function CancellationQueue({ requests }: { requests: Request[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(request: Request, approve: boolean) {
    setBusyId(request.id);

    const result = await apiPost<{ message: string }>("/api/cancellations/decide", {
      requestId: request.id,
      approve,
    });

    setBusyId(null);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    toast.success(result.data.message);
    startTransition(() => router.refresh());
  }

  return (
    <Card>
      <CardHeader
        title="Waiting for you"
        description={`${requests.length} request${requests.length === 1 ? "" : "s"}`}
      />
      <ul className="divide-line divide-y">
        {requests.map((request) => {
          const isBusy = busyId === request.id || isPending;

          return (
            <li key={request.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-body text-text font-medium">{request.personName}</p>
                  <p className="text-text-muted text-label mt-0.5">
                    {formatDayShort(request.dateKey)}
                    {request.dayTitle ? ` · ${request.dayTitle}` : ""}
                  </p>
                  <p className="text-text-muted text-label mt-1 wrap-break-word">
                    {request.itemSummary || "—"}
                  </p>
                  {request.reason && (
                    <p className="text-text-subtle text-caption mt-1 italic wrap-break-word">
                      &ldquo;{request.reason}&rdquo;
                    </p>
                  )}
                </div>
                <Money paise={request.orderTotalPaise} />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" isLoading={isBusy} onClick={() => decide(request, true)}>
                  <Check className="size-4" aria-hidden />
                  Cancel it — no charge
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isBusy}
                  onClick={() => decide(request, false)}
                >
                  <X className="size-4" aria-hidden />
                  Decline — they pay
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
