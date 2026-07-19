"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { apiPost } from "@/lib/api/client";
import { parseRupeeInput } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Money } from "@/components/ui/money";

type ExistingItem = { id: string; name: string; unitPricePaise: number; holders: number };
type NewItem = { name: string; unitPricePaise: number };

/**
 * Re-poll after the provider reports a shortage.
 *
 * Deep unticks what's unavailable and adds replacements. People whose choices
 * are untouched keep their orders; only those holding a withdrawn item are
 * asked again — and their single effective order is updated, never duplicated.
 */
export function RepollForm({
  dateKey,
  currentRound,
  items,
}: {
  dateKey: string;
  currentRound: number;
  items: ExistingItem[];
}) {
  const [keepIds, setKeepIds] = useState<Set<string>>(new Set(items.map((item) => item.id)));
  const [reason, setReason] = useState("");
  const [deadlineTime, setDeadlineTime] = useState("");
  const [newItems, setNewItems] = useState<NewItem[]>([]);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [priceError, setPriceError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const withdrawn = items.filter((item) => !keepIds.has(item.id));
  // People who will have to choose again. Approximate (an item can appear in
  // several orders), but it's the number Deep needs before committing.
  const affectedEstimate = withdrawn.reduce((sum, item) => sum + item.holders, 0);

  function toggleKeep(id: string) {
    setKeepIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addReplacement() {
    const paise = parseRupeeInput(newPrice);
    if (paise === null) {
      setPriceError("Enter a price like 40 or 40.50.");
      return;
    }
    const trimmed = newName.trim();
    if (!trimmed) return;

    setNewItems((current) => [...current, { name: trimmed, unitPricePaise: paise }]);
    setNewName("");
    setNewPrice("");
    setPriceError(null);
  }

  async function handleSubmit() {
    if (!reason.trim()) {
      toast.error("Add a reason — people will see it when they're asked to re-order.");
      return;
    }
    if (!deadlineTime) {
      toast.error("Set a closing time for the new round.");
      return;
    }

    setIsSubmitting(true);
    const result = await apiPost<{ message: string }>("/api/admin/day/repoll", {
      dateKey,
      reason,
      deadlineTime,
      keepItemIds: [...keepIds],
      newItems,
    });
    setIsSubmitting(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    toast.success(result.data.message);
    window.location.assign(`/admin/today/summary?date=${dateKey}`);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`Round ${currentRound + 1}`}
          description="Untick anything the provider has run out of"
        />
        <ul className="divide-line divide-y">
          {items.map((item) => {
            const keeping = keepIds.has(item.id);
            return (
              <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                <input
                  id={`keep-${item.id}`}
                  type="checkbox"
                  checked={keeping}
                  onChange={() => toggleKeep(item.id)}
                  className="accent-primary size-5 shrink-0"
                />
                <label htmlFor={`keep-${item.id}`} className="min-w-0 flex-1 cursor-pointer">
                  <span
                    className={
                      keeping
                        ? "text-body text-text"
                        : "text-body text-text-subtle line-through"
                    }
                  >
                    {item.name}
                  </span>
                  {item.holders > 0 && (
                    <span className="text-text-muted text-caption ml-2">
                      {item.holders} ordered
                    </span>
                  )}
                </label>
                <Money paise={item.unitPricePaise} variant="muted" />
              </li>
            );
          })}
        </ul>
      </Card>

      {withdrawn.length > 0 && (
        <div
          role="status"
          className="border-warning-border bg-warning-subtle flex items-start gap-2 rounded-lg border px-4 py-3"
        >
          <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="text-warning text-body">
            <p className="font-medium">
              Removing {withdrawn.map((item) => item.name).join(", ")}
            </p>
            <p className="mt-0.5 opacity-90">
              {affectedEstimate === 0
                ? "Nobody has ordered these, so no one needs to choose again."
                : `${affectedEstimate} order line${affectedEstimate === 1 ? "" : "s"} will be removed and those people will need to pick again. Nobody gets billed twice.`}
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader title="Replacements" description="What the provider is offering instead" />
        {newItems.length > 0 && (
          <ul className="divide-line divide-y">
            {newItems.map((item, index) => (
              <li key={`${item.name}-${index}`} className="flex items-center gap-3 px-5 py-3">
                <span className="text-body text-text min-w-0 flex-1">{item.name}</span>
                <Money paise={item.unitPricePaise} />
                <button
                  type="button"
                  onClick={() => setNewItems((c) => c.filter((_, i) => i !== index))}
                  aria-label={`Remove ${item.name}`}
                  className="text-text-subtle hover:text-danger flex size-11 shrink-0 items-center justify-center rounded-md"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <CardBody className="border-line border-t">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field
                label="Item name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Mixed veg"
                maxLength={60}
              />
            </div>
            <div className="sm:w-32">
              <Field
                label="Price (₹)"
                value={newPrice}
                onChange={(e) => {
                  setNewPrice(e.target.value);
                  setPriceError(null);
                }}
                inputMode="decimal"
                placeholder="40"
                error={priceError ?? undefined}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={addReplacement}
              disabled={!newName.trim() || !newPrice.trim()}
            >
              <Plus className="size-4" aria-hidden />
              Add
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Round details" />
        <CardBody className="space-y-4">
          <Field
            label="Why are you re-polling?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Provider ran out of paneer"
            hint="Shown to everyone who needs to choose again."
            maxLength={200}
          />
          <Field
            label="New round closes at"
            type="time"
            value={deadlineTime}
            onChange={(e) => setDeadlineTime(e.target.value)}
            hint="Usually a short window — people are waiting on lunch."
          />
        </CardBody>
      </Card>

      <Button
        onClick={handleSubmit}
        isLoading={isSubmitting}
        loadingText="Opening round…"
        disabled={!reason.trim() || !deadlineTime}
        size="lg"
        fullWidth
      >
        <RefreshCw className="size-4" aria-hidden />
        Open round {currentRound + 1}
      </Button>
    </div>
  );
}
