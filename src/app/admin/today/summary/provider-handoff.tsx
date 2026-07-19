"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Copy, Lock, RefreshCw, Send } from "lucide-react";
import { apiPost } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { StatusPill, type StatusKind } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/page-state";

type SummaryItem = { name: string; totalQuantity: number; lineTotalPaise: number };
type BreakdownRow = {
  personId: string;
  name: string;
  status: string;
  itemSummary: string;
  totalPaise: number;
};

const DAY_STATUS_PILL: Record<string, StatusKind> = {
  draft: "draft",
  published: "published",
  locked: "locked",
  sent_to_provider: "sent_to_provider",
  settled: "settled",
};

/**
 * The handoff screen: aggregated counts to send the provider, plus the
 * per-person breakdown behind them.
 *
 * The copy button produces plain text for WhatsApp — the provider is not a
 * user of this app, and shouldn't have to be.
 */
export function ProviderHandoff({
  dateKey,
  dayStatus,
  deadlineLabel,
  summary,
  breakdown,
  message,
  items,
}: {
  dateKey: string;
  dayStatus: string;
  deadlineLabel: string | null;
  summary: { peopleCount: number; totalPaise: number };
  breakdown: BreakdownRow[];
  message: string;
  items: SummaryItem[];
}) {
  const router = useRouter();
  const [isLocking, setIsLocking] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const isOpen = dayStatus === "published";
  const canSend = dayStatus === "locked";
  const alreadySent = dayStatus === "sent_to_provider" || dayStatus === "settled";

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Copied — paste it to the provider.");
    } catch {
      toast.error("Couldn't copy. Select the text and copy it manually.");
    }
  }

  async function closeOrdering() {
    setIsLocking(true);
    const result = await apiPost("/api/admin/day/lock", { dateKey });
    setIsLocking(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Ordering closed. Counts are final.");
    router.refresh();
  }

  async function markSent() {
    setIsSending(true);
    const result = await apiPost("/api/admin/day/sent", { dateKey });
    setIsSending(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Marked as sent to the provider.");
    router.refresh();
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardHeader title="Nothing ordered" action={<StatusPill status={DAY_STATUS_PILL[dayStatus]} />} />
        <CardBody>
          <EmptyState
            title="No orders for this day"
            description="Nobody has ordered yet, so there's nothing to send the provider."
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {isOpen && (
        <div
          role="status"
          className="border-warning-border bg-warning-subtle rounded-lg border px-4 py-3"
        >
          <p className="text-warning text-body">
            Ordering is still open{deadlineLabel ? ` until ${deadlineLabel}` : ""}. These counts
            can still change — close ordering first if you&rsquo;re sending them now.
          </p>
        </div>
      )}

      <Card>
        <CardHeader
          title="Counts to send"
          description={`${summary.peopleCount} ${summary.peopleCount === 1 ? "person" : "people"}`}
          action={<StatusPill status={DAY_STATUS_PILL[dayStatus]} />}
        />
        <ul className="divide-line divide-y">
          {items.map((item) => (
            <li key={item.name} className="flex items-center gap-3 px-5 py-3">
              <span className="text-body text-text min-w-0 flex-1 wrap-break-word">
                {item.name}
              </span>
              <span data-numeric className="text-title text-text font-mono">
                {item.totalQuantity}
              </span>
              <Money paise={item.lineTotalPaise} variant="muted" className="w-20 text-right" />
            </li>
          ))}
        </ul>
        <CardBody className="border-line flex items-center justify-between border-t">
          <span className="text-text-muted text-body">Day total</span>
          <Money paise={summary.totalPaise} variant="total" />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Message for the provider" description="Plain text for WhatsApp" />
        <CardBody className="space-y-3">
          <pre className="bg-surface-raised border-line text-text overflow-x-auto rounded-md border px-3 py-2 text-label whitespace-pre-wrap">
            {message}
          </pre>
          <Button onClick={copyMessage} fullWidth>
            <Copy className="size-4" aria-hidden />
            Copy for WhatsApp
          </Button>
        </CardBody>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row">
        {isOpen && (
          <Button
            variant="secondary"
            onClick={closeOrdering}
            isLoading={isLocking}
            loadingText="Closing…"
            fullWidth
          >
            <Lock className="size-4" aria-hidden />
            Close ordering now
          </Button>
        )}
        {canSend && (
          <Button onClick={markSent} isLoading={isSending} loadingText="Saving…" fullWidth>
            <Send className="size-4" aria-hidden />
            Mark as sent
          </Button>
        )}
        {alreadySent && (
          // The re-poll path: the provider has the counts and has come back
          // with a shortage.
          <Link
            href={`/admin/today/repoll?date=${dateKey}`}
            className="border-line-strong bg-surface text-text hover:bg-surface-raised inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border px-4 text-body font-medium transition-colors"
          >
            <RefreshCw className="size-4" aria-hidden />
            Provider is short of something
          </Link>
        )}
      </div>

      <Card>
        <CardHeader title="Who ordered what" description={`${breakdown.length} people`} />
        <ul className="divide-line divide-y">
          {breakdown.map((row) => (
            <li key={row.personId} className="px-5 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body text-text font-medium">{row.name}</span>
                    {row.status === "cancelled" && <StatusPill status="cancelled" />}
                  </div>
                  <p className="text-text-muted text-label mt-0.5 wrap-break-word">
                    {row.itemSummary || "—"}
                  </p>
                </div>
                <Money
                  paise={row.status === "cancelled" ? 0 : row.totalPaise}
                  variant={row.status === "cancelled" ? "muted" : "default"}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
