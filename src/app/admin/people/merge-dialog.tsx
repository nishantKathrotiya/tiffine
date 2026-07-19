"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { apiPost } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import type { PersonRow } from "./people-table";

/**
 * Merge a duplicate account into the one to keep.
 *
 * Merging moves order history between people and therefore changes who gets
 * billed, so it is confirmed explicitly and states the consequence in plain
 * language rather than relying on the word "merge" to convey it.
 */
export function MergeDialog({
  source,
  candidates,
  onClose,
  onMerged,
}: {
  source: PersonRow;
  candidates: PersonRow[];
  onClose: () => void;
  onMerged: () => void;
}) {
  const [targetId, setTargetId] = useState<string>("");
  const [isMerging, setIsMerging] = useState(false);

  const target = candidates.find((candidate) => candidate.id === targetId);

  async function handleMerge() {
    if (!targetId) return;
    setIsMerging(true);

    const result = await apiPost<{ ordersMoved: number; message: string }>(
      "/api/admin/people/merge",
      { sourceId: source.id, targetId },
    );

    setIsMerging(false);

    if (!result.ok) {
      // Overlapping-day conflicts arrive here; the message explains the fix.
      toast.error(result.error.message);
      return;
    }

    toast.success(result.data.message);
    onMerged();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      style={{ background: "var(--overlay)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-title"
        className="bg-surface border-line w-full max-w-md rounded-lg border p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="merge-title" className="text-title text-text">
          Merge duplicate account
        </h2>
        <p className="text-text-muted text-body mt-1">
          Move <strong className="text-text">{source.name}</strong>&rsquo;s orders into another
          account, then deactivate this one.
        </p>

        <label htmlFor="merge-target" className="text-label text-text mt-5 block">
          Keep this account
        </label>
        <select
          id="merge-target"
          value={targetId}
          onChange={(event) => setTargetId(event.target.value)}
          className="border-line-strong bg-surface text-text mt-1.5 min-h-11 w-full rounded-md border px-3 text-body"
        >
          <option value="">Choose an account…</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} ({candidate.email})
            </option>
          ))}
        </select>

        {target && (
          <div className="border-warning-border bg-warning-subtle mt-4 flex items-start gap-2 rounded-md border px-3 py-2.5">
            <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="text-warning text-caption">
              {source.orderCount} order{source.orderCount === 1 ? "" : "s"} will move to{" "}
              {target.name}, and {source.name} will be deactivated. This can&rsquo;t be undone
              from here.
            </p>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isMerging}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleMerge}
            disabled={!targetId}
            isLoading={isMerging}
            loadingText="Merging…"
          >
            Merge accounts
          </Button>
        </div>
      </div>
    </div>
  );
}
