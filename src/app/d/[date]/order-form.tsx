"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Clock, Lock, Minus, Plus } from "lucide-react";
import { apiPost } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { StatusPill } from "@/components/ui/status-pill";
import { formatCountdown, formatTime } from "@/lib/time";
import { CancellationRequest } from "@/components/cancellation-request";
import { multiplyPaise, sumPaise } from "@/lib/money";

type MenuItemView = { id: string; name: string; unitPricePaise: number };
type LineDraft = { menuItemId: string; quantity: number };

const MAX_QUANTITY = 20;

/**
 * The daily ordering screen.
 *
 * Quantities are held locally and submitted as one payload, so the running
 * total is instant and a slow connection can't leave a half-saved order. The
 * deadline is enforced server-side regardless of what this component shows.
 */
export function OrderForm({
  dateKey,
  items,
  existingLines,
  deadlineAt,
  isOpen,
  canOrder,
  dayStatus,
  existingCancellation,
}: {
  dateKey: string;
  items: MenuItemView[];
  existingLines: LineDraft[];
  deadlineAt: string;
  isOpen: boolean;
  canOrder: boolean;
  dayStatus: string;
  existingCancellation: { status: "pending" | "approved" | "rejected"; decisionNote: string | null } | null;
}) {
  const deadline = useMemo(() => new Date(deadlineAt), [deadlineAt]);

  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(existingLines.map((line) => [line.menuItemId, line.quantity])),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(
    existingLines.length > 0 ? new Date() : null,
  );

  // Ticking countdown so the closing time is visible without a refresh. The
  // page also flips to read-only the moment it passes.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const deadlinePassed = now.getTime() >= deadline.getTime();
  // Kept distinct from canEdit: a day can still be open while *this* viewer
  // can't order (pending or deactivated). Collapsing the two would tell them
  // ordering had closed, which is both wrong and hides the real reason.
  const orderingOpen = isOpen && !deadlinePassed;
  const canEdit = orderingOpen && canOrder;

  const lines = useMemo(
    () =>
      items
        .filter((item) => (quantities[item.id] ?? 0) > 0)
        .map((item) => ({
          menuItemId: item.id,
          quantity: quantities[item.id],
          unitPricePaise: item.unitPricePaise,
        })),
    [items, quantities],
  );

  const total = useMemo(
    () => sumPaise(lines.map((line) => multiplyPaise(line.unitPricePaise, line.quantity))),
    [lines],
  );

  const hasExistingOrder = existingLines.length > 0;
  const isDirty = useMemo(() => {
    const before = new Map(existingLines.map((line) => [line.menuItemId, line.quantity]));
    const after = new Map(lines.map((line) => [line.menuItemId, line.quantity]));
    if (before.size !== after.size) return true;
    for (const [id, qty] of after) if (before.get(id) !== qty) return true;
    return false;
  }, [existingLines, lines]);

  function setQuantity(itemId: string, next: number) {
    const clamped = Math.max(0, Math.min(MAX_QUANTITY, next));
    setQuantities((current) => ({ ...current, [itemId]: clamped }));
  }

  async function handleSubmit() {
    setIsSaving(true);

    const result = await apiPost<{ orderId: string | null; message: string }>("/api/orders", {
      dateKey,
      lines: lines.map((line) => ({
        menuItemId: line.menuItemId,
        quantity: line.quantity,
      })),
    });

    setIsSaving(false);

    if (!result.ok) {
      toast.error(result.error.message);
      // A deadline or availability rejection means this page is stale; reload
      // so the person sees the real state rather than a form that lies.
      if (["DEADLINE_PASSED", "ITEM_UNAVAILABLE", "ROUND_CLOSED", "DAY_LOCKED"].includes(result.error.code)) {
        setTimeout(() => window.location.reload(), 1800);
      }
      return;
    }

    setSavedAt(new Date());
    toast.success(result.data.message);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Pick your items"
          // Describes the DAY, not this viewer's permission — a pending user
          // must still see the real closing time.
          description={
            orderingOpen
              ? `Ordering closes at ${formatTime(deadline)}`
              : `Ordering closed at ${formatTime(deadline)}`
          }
          action={
            orderingOpen ? (
              <span className="border-warning-border bg-warning-subtle text-warning inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-medium">
                <Clock className="size-3" aria-hidden />
                {formatCountdown(deadline, now)}
              </span>
            ) : (
              <StatusPill status={dayStatus === "published" ? "locked" : (dayStatus as "locked")} />
            )
          }
        />

        <ul className="divide-line divide-y">
          {items.map((item) => {
            const quantity = quantities[item.id] ?? 0;
            return (
              <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-body text-text wrap-break-word">{item.name}</p>
                  <Money paise={item.unitPricePaise} variant="muted" className="text-caption" />
                </div>

                {canEdit ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setQuantity(item.id, quantity - 1)}
                      disabled={quantity === 0}
                      aria-label={`One less ${item.name}`}
                      className="border-line-strong text-text hover:bg-surface-raised flex size-11 items-center justify-center rounded-md border transition-colors disabled:opacity-40"
                    >
                      <Minus className="size-4" aria-hidden />
                    </button>

                    <span
                      data-numeric
                      aria-label={`${item.name} quantity`}
                      className="text-body text-text w-8 text-center font-mono"
                    >
                      {quantity}
                    </span>

                    <button
                      type="button"
                      onClick={() => setQuantity(item.id, quantity + 1)}
                      disabled={quantity >= MAX_QUANTITY}
                      aria-label={`One more ${item.name}`}
                      className="border-line-strong text-text hover:bg-surface-raised flex size-11 items-center justify-center rounded-md border transition-colors disabled:opacity-40"
                    >
                      <Plus className="size-4" aria-hidden />
                    </button>
                  </div>
                ) : (
                  <span data-numeric className="text-body text-text-muted shrink-0 font-mono">
                    {quantity > 0 ? `×${quantity}` : "—"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        <CardBody className="border-line flex items-center justify-between border-t">
          <span className="text-text-muted text-body">
            {lines.length === 0
              ? "Nothing selected"
              : `${lines.length} item${lines.length === 1 ? "" : "s"}`}
          </span>
          <Money paise={total} variant="total" />
        </CardBody>
      </Card>

      {canEdit ? (
        <div className="space-y-2">
          <Button
            onClick={handleSubmit}
            isLoading={isSaving}
            loadingText="Saving…"
            disabled={!isDirty && hasExistingOrder}
            size="lg"
            fullWidth
          >
            <Check className="size-4" aria-hidden />
            {lines.length === 0 && hasExistingOrder
              ? "Clear my order"
              : hasExistingOrder
                ? "Update my order"
                : "Place my order"}
          </Button>

          <p className="text-text-muted text-caption text-center">
            {savedAt && !isDirty
              ? `Saved. You can change this until ${formatTime(deadline)}.`
              : `You can change or cancel this until ${formatTime(deadline)}.`}
          </p>
        </div>
      ) : (
        <div className="border-line bg-surface-raised flex items-start gap-3 rounded-lg border px-4 py-3">
          <Lock className="text-text-muted mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="text-text-muted text-body">
            {!canOrder
              ? orderingOpen
                ? // Open day, but this account can't act — say so without
                  // implying the deadline has passed.
                  `Ordering is open until ${formatTime(deadline)}, but your account can't place orders yet. This menu is read-only for now.`
                : "Your account can't place orders, so this menu is read-only."
              : hasExistingOrder
                ? "Ordering has closed. Your order is locked in — ask an admin if you need it cancelled."
                : "Ordering has closed for this day."}
          </p>
        </div>
      )}

      {/* Only after the deadline, and only if there's an order to cancel —
          before that the person just edits it themselves. */}
      {!orderingOpen && canOrder && hasExistingOrder && dayStatus !== "settled" && (
        <CancellationRequest dateKey={dateKey} existing={existingCancellation} />
      )}
    </div>
  );
}
