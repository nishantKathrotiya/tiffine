"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import { apiPost } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";

type ExistingRequest = {
  status: "pending" | "approved" | "rejected";
  decisionNote: string | null;
} | null;

/**
 * Post-deadline cancellation.
 *
 * Only rendered once ordering has closed — before that the person edits or
 * clears their own order, which needs no approval.
 */
export function CancellationRequest({
  dateKey,
  existing,
}: {
  dateKey: string;
  existing: ExistingRequest;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(existing);

  async function submit() {
    setIsSubmitting(true);
    const result = await apiPost<{ message: string }>("/api/cancellations/request", {
      dateKey,
      reason: reason.trim() || undefined,
    });
    setIsSubmitting(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    setSubmitted({ status: "pending", decisionNote: null });
    setIsOpen(false);
    toast.success(result.data.message);
  }

  if (submitted) {
    return (
      <div className="border-line bg-surface flex items-start gap-3 rounded-lg border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body text-text font-medium">Cancellation</span>
            <StatusPill status={submitted.status} />
          </div>
          <p className="text-text-muted text-label mt-1">
            {submitted.status === "pending"
              ? "An admin will approve or decline this shortly."
              : submitted.status === "approved"
                ? "Approved — you won't get a tiffin and won't be billed for it."
                : "Declined — the tiffin is being delivered, so it stays on your bill."}
          </p>
          {submitted.decisionNote && (
            <p className="text-text-subtle text-caption mt-1 italic">
              &ldquo;{submitted.decisionNote}&rdquo;
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!isOpen) {
    return (
      <Button variant="secondary" onClick={() => setIsOpen(true)} fullWidth>
        <Ban className="size-4" aria-hidden />
        Request cancellation
      </Button>
    );
  }

  return (
    <div className="border-line bg-surface space-y-3 rounded-lg border px-4 py-4">
      <div>
        <p className="text-body text-text font-medium">Request a cancellation</p>
        {/* Sets expectations honestly: this is a request, not a guarantee. */}
        <p className="text-text-muted text-label mt-1">
          Ordering has closed, so an admin has to approve this. If the tiffin has already been
          made, they may decline and you&rsquo;ll still be billed.
        </p>
      </div>

      <div>
        <label htmlFor="cancel-reason" className="text-label text-text mb-1.5 block">
          Reason (optional)
        </label>
        <textarea
          id="cancel-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          maxLength={200}
          placeholder="Stepping out for a meeting"
          className="border-line-strong bg-surface text-text w-full rounded-md border px-3 py-2 text-body"
        />
      </div>

      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setIsOpen(false)} disabled={isSubmitting} fullWidth>
          Never mind
        </Button>
        <Button onClick={submit} isLoading={isSubmitting} loadingText="Sending…" fullWidth>
          Send request
        </Button>
      </div>
    </div>
  );
}
