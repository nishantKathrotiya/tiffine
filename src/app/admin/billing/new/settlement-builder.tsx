"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Calculator, Check, CircleAlert } from "lucide-react";
import { apiPost } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Money } from "@/components/ui/money";
import { EmptyState } from "@/components/ui/page-state";
import { formatDayShort } from "@/lib/time";

type PersonTotal = {
  personId: string;
  name: string;
  totalPaise: number;
  dayCount: number;
};

type Preview = {
  perPerson: PersonTotal[];
  totalPaise: number;
  dayCount: number;
  overlappingDays: { dateKey: string; runLabel: string }[];
  unbilledGaps: string[];
};

/**
 * Build a settlement run: pick a range, preview, commit.
 *
 * Two failure modes get equal weight here. Overlap (billing a day twice) is
 * blocked unless explicitly overridden; gaps (a day no run covers) are shown
 * alongside, because silently skipping a day is just as wrong and far easier
 * to miss.
 */
export function SettlementBuilder({
  defaultStart,
  defaultEnd,
}: {
  defaultStart: string;
  defaultEnd: string;
}) {
  const [periodStart, setPeriodStart] = useState(defaultStart);
  const [periodEnd, setPeriodEnd] = useState(defaultEnd);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [confirmOverlap, setConfirmOverlap] = useState(false);

  async function runPreview() {
    setIsPreviewing(true);
    setPreview(null);
    setConfirmOverlap(false);

    const result = await apiPost<Preview>("/api/admin/settlement/preview", {
      periodStart,
      periodEnd,
    });

    setIsPreviewing(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setPreview(result.data);
  }

  async function commit() {
    if (!preview) return;
    setIsCommitting(true);

    const result = await apiPost<{ runId: string; message: string }>(
      "/api/admin/settlement/commit",
      { periodStart, periodEnd, includeOverlapping: confirmOverlap },
    );

    setIsCommitting(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    toast.success(result.data.message);
    window.location.assign(`/admin/billing/${result.data.runId}`);
  }

  const hasOverlap = (preview?.overlappingDays.length ?? 0) > 0;
  const canCommit = preview && preview.perPerson.length > 0 && (!hasOverlap || confirmOverlap);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Period" description="Any range — 7 days, 20 days, whatever you paid on" />
        <CardBody className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <Field
                label="From"
                type="date"
                value={periodStart}
                onChange={(event) => setPeriodStart(event.target.value)}
              />
            </div>
            <div className="flex-1">
              <Field
                label="To"
                type="date"
                value={periodEnd}
                onChange={(event) => setPeriodEnd(event.target.value)}
              />
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={runPreview}
            isLoading={isPreviewing}
            loadingText="Calculating…"
            fullWidth
          >
            <Calculator className="size-4" aria-hidden />
            Preview totals
          </Button>
        </CardBody>
      </Card>

      {preview && (
        <>
          {hasOverlap && (
            <div className="border-warning-border bg-warning-subtle rounded-lg border px-4 py-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="text-warning text-body">
                  <p className="font-medium">
                    {preview.overlappingDays.length} day
                    {preview.overlappingDays.length === 1 ? " has" : "s have"} already been billed
                  </p>
                  <p className="mt-0.5 opacity-90">
                    {preview.overlappingDays
                      .slice(0, 4)
                      .map((day) => formatDayShort(day.dateKey))
                      .join(", ")}
                    {preview.overlappingDays.length > 4
                      ? ` and ${preview.overlappingDays.length - 4} more`
                      : ""}{" "}
                    — already in {preview.overlappingDays[0].runLabel}. They&rsquo;re excluded
                    from the totals below.
                  </p>
                  <label className="mt-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={confirmOverlap}
                      onChange={(event) => setConfirmOverlap(event.target.checked)}
                      className="accent-warning size-4"
                    />
                    <span className="text-caption">
                      Bill them again anyway (I&rsquo;m deliberately re-billing)
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {preview.unbilledGaps.length > 0 && (
            // The opposite of overlap: days that would be silently skipped.
            <div className="border-info-border bg-info-subtle rounded-lg border px-4 py-3">
              <div className="flex items-start gap-2">
                <CircleAlert className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="text-info text-body">
                  <p className="font-medium">
                    {preview.unbilledGaps.length} closed day
                    {preview.unbilledGaps.length === 1 ? "" : "s"} in this range
                    {preview.unbilledGaps.length === 1 ? " has" : " have"} never been billed
                  </p>
                  <p className="mt-0.5 opacity-90">
                    {preview.unbilledGaps.slice(0, 5).map(formatDayShort).join(", ")}
                    {preview.unbilledGaps.length > 5
                      ? ` and ${preview.unbilledGaps.length - 5} more`
                      : ""}
                    . They&rsquo;re included below.
                  </p>
                </div>
              </div>
            </div>
          )}

          <Card>
            <CardHeader
              title="Per person"
              description={`${preview.dayCount} day${preview.dayCount === 1 ? "" : "s"} · ${preview.perPerson.length} ${preview.perPerson.length === 1 ? "person" : "people"}`}
            />

            {preview.perPerson.length === 0 ? (
              <CardBody>
                <EmptyState
                  title="Nothing to bill"
                  description="No closed days with orders in this range. Days become billable once ordering has closed."
                />
              </CardBody>
            ) : (
              <>
                <ul className="divide-line divide-y">
                  {preview.perPerson.map((person) => (
                    <li
                      key={person.personId}
                      className="flex items-center justify-between gap-3 px-5 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-body text-text wrap-break-word">{person.name}</p>
                        <p className="text-text-subtle text-caption">
                          {person.dayCount} day{person.dayCount === 1 ? "" : "s"}
                        </p>
                      </div>
                      <Money paise={person.totalPaise} />
                    </li>
                  ))}
                </ul>
                <CardBody className="border-line flex items-center justify-between border-t">
                  <span className="text-text-muted text-body">Group total</span>
                  <Money paise={preview.totalPaise} variant="total" />
                </CardBody>
              </>
            )}
          </Card>

          {preview.perPerson.length > 0 && (
            <div className="space-y-2">
              <Button
                onClick={commit}
                isLoading={isCommitting}
                loadingText="Committing…"
                disabled={!canCommit}
                size="lg"
                fullWidth
              >
                <Check className="size-4" aria-hidden />
                Commit settlement
              </Button>
              <p className="text-text-muted text-caption text-center">
                Committing locks these days so they can&rsquo;t be billed again by mistake.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
