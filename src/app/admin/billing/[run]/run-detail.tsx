"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, Copy, RotateCcw, Send } from "lucide-react";
import { apiPost } from "@/lib/api/client";
import { buildPaymentMessage, buildUpiLink } from "@/lib/upi";
import { formatPaise, parseRupeeInput } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Money } from "@/components/ui/money";
import { StatusPill } from "@/components/ui/status-pill";

type Line = {
  id: string;
  name: string;
  totalPaise: number;
  paymentStatus: "pending" | "paid" | "waived";
};

/**
 * A committed run: per-person amounts, provider reconciliation, and payment
 * tracking.
 *
 * The reconciliation field is the important one — if the provider's invoice
 * and the system disagree, Deep needs to see it *before* collecting money,
 * not after.
 */
export function RunDetail({
  runId,
  periodLabel,
  totalPaise,
  providerBillPaise,
  reconciliation,
  collectedPaise,
  outstandingPaise,
  dayCount,
  lines,
  upiPayeeVpa,
  upiPayeeName,
}: {
  runId: string;
  periodLabel: string;
  totalPaise: number;
  providerBillPaise: number | null;
  reconciliation: { deltaPaise: number; matches: boolean } | null;
  collectedPaise: number;
  outstandingPaise: number;
  dayCount: number;
  lines: Line[];
  upiPayeeVpa: string;
  upiPayeeName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [billInput, setBillInput] = useState(
    providerBillPaise === null ? "" : (providerBillPaise / 100).toFixed(2),
  );
  const [billError, setBillError] = useState<string | null>(null);
  const [isSavingBill, setIsSavingBill] = useState(false);

  async function saveProviderBill() {
    const trimmed = billInput.trim();
    const paise = trimmed === "" ? null : parseRupeeInput(trimmed);

    if (trimmed !== "" && paise === null) {
      setBillError("Enter an amount like 18600 or 18600.50.");
      return;
    }

    setIsSavingBill(true);
    const result = await apiPost("/api/admin/settlement/provider-bill", {
      runId,
      providerBillPaise: paise,
    });
    setIsSavingBill(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setBillError(null);
    toast.success("Provider bill saved.");
    startTransition(() => router.refresh());
  }

  async function setPayment(line: Line, status: "pending" | "paid" | "waived") {
    setBusyId(line.id);
    const result = await apiPost("/api/admin/settlement/payment", { lineId: line.id, status });
    setBusyId(null);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    startTransition(() => router.refresh());
  }

  async function copyFor(line: Line) {
    const upiLink = buildUpiLink({
      payeeVpa: upiPayeeVpa,
      payeeName: upiPayeeName,
      amountPaise: line.totalPaise,
      note: `Tiffin ${periodLabel}`,
    });

    const message = buildPaymentMessage({
      personName: line.name,
      amountPaise: line.totalPaise,
      periodLabel,
      upiLink,
    });

    try {
      await navigator.clipboard.writeText(message);
      toast.success(
        upiLink ? `Copied ${line.name}'s message with payment link.` : `Copied ${line.name}'s message.`,
      );
    } catch {
      toast.error("Couldn't copy. Select the text and copy it manually.");
    }
  }

  async function copyAll() {
    const unpaid = lines.filter((line) => line.paymentStatus === "pending");
    const blocks = unpaid.map((line) =>
      buildPaymentMessage({
        personName: line.name,
        amountPaise: line.totalPaise,
        periodLabel,
        upiLink: buildUpiLink({
          payeeVpa: upiPayeeVpa,
          payeeName: upiPayeeName,
          amountPaise: line.totalPaise,
          note: `Tiffin ${periodLabel}`,
        }),
      }),
    );

    try {
      await navigator.clipboard.writeText(blocks.join("\n\n---\n\n"));
      toast.success(`Copied ${unpaid.length} message${unpaid.length === 1 ? "" : "s"}.`);
    } catch {
      toast.error("Couldn't copy.");
    }
  }

  const upiConfigured = Boolean(upiPayeeVpa);
  const pendingCount = lines.filter((line) => line.paymentStatus === "pending").length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Totals"
          description={`${dayCount} day${dayCount === 1 ? "" : "s"} · ${lines.length} ${lines.length === 1 ? "person" : "people"}`}
          action={<StatusPill status="settled" />}
        />
        <CardBody className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-text-muted text-body">System total</span>
            <Money paise={totalPaise} variant="total" />
          </div>
          <div className="border-line flex items-center justify-between border-t pt-3">
            <span className="text-text-muted text-body">Collected</span>
            <Money paise={collectedPaise} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-muted text-body">Outstanding</span>
            <Money paise={outstandingPaise} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Provider's bill"
          description="Enter what they actually invoiced"
        />
        <CardBody className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field
                label="Invoice amount (₹)"
                value={billInput}
                onChange={(event) => {
                  setBillInput(event.target.value);
                  setBillError(null);
                }}
                inputMode="decimal"
                placeholder={(totalPaise / 100).toFixed(2)}
                error={billError ?? undefined}
              />
            </div>
            <Button
              variant="secondary"
              onClick={saveProviderBill}
              isLoading={isSavingBill}
              loadingText="Saving…"
            >
              Save
            </Button>
          </div>

          {/* The check that matters: a mismatch has to surface before money is
              collected, not after everyone has paid the wrong amount. */}
          {reconciliation && (
            <div
              className={
                reconciliation.matches
                  ? "border-success-border bg-success-subtle flex items-start gap-2 rounded-md border px-3 py-2.5"
                  : "border-danger-border bg-danger-subtle flex items-start gap-2 rounded-md border px-3 py-2.5"
              }
            >
              {reconciliation.matches ? (
                <Check className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
              ) : (
                <AlertTriangle className="text-danger mt-0.5 size-4 shrink-0" aria-hidden />
              )}
              <p className={reconciliation.matches ? "text-success text-body" : "text-danger text-body"}>
                {reconciliation.matches
                  ? "Matches the system total exactly."
                  : `Off by ${formatPaise(Math.abs(reconciliation.deltaPaise))} — the provider billed ${reconciliation.deltaPaise > 0 ? "more" : "less"} than the orders add up to. Check before collecting.`}
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Who owes what"
          description={`${pendingCount} unpaid`}
          action={
            pendingCount > 0 ? (
              <Button size="sm" variant="secondary" onClick={copyAll}>
                <Copy className="size-4" aria-hidden />
                Copy all
              </Button>
            ) : undefined
          }
        />

        {!upiConfigured && (
          <div className="border-line bg-surface-raised border-b px-5 py-3">
            <p className="text-text-muted text-caption">
              Set NEXT_PUBLIC_UPI_PAYEE_VPA to include prefilled payment links in these messages.
            </p>
          </div>
        )}

        <ul className="divide-line divide-y">
          {lines.map((line) => {
            const isBusy = busyId === line.id || isPending;
            return (
              <li key={line.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-body text-text font-medium">{line.name}</span>
                      <StatusPill
                        status={
                          line.paymentStatus === "paid"
                            ? "paid"
                            : line.paymentStatus === "waived"
                              ? "waived"
                              : "unpaid"
                        }
                      />
                    </div>
                  </div>
                  <Money paise={line.totalPaise} />
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  {line.paymentStatus === "pending" ? (
                    <>
                      <Button size="sm" isLoading={isBusy} onClick={() => setPayment(line, "paid")}>
                        <Check className="size-4" aria-hidden />
                        Mark paid
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isBusy}
                        onClick={() => copyFor(line)}
                      >
                        <Send className="size-4" aria-hidden />
                        Copy request
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isBusy}
                        onClick={() => setPayment(line, "waived")}
                      >
                        Waive
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isBusy}
                      onClick={() => setPayment(line, "pending")}
                    >
                      <RotateCcw className="size-4" aria-hidden />
                      Mark unpaid
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
