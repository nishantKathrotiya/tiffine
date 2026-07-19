"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, Copy, Lock, Plus, Send, Trash2 } from "lucide-react";
import { apiPost } from "@/lib/api/client";
import { formatPaise, parseRupeeInput } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Money } from "@/components/ui/money";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/page-state";
import { formatTime } from "@/lib/time";

type ItemDraft = { name: string; unitPricePaise: number };

type RecentItem = {
  name: string;
  normalizedName: string;
  unitPricePaise: number;
  timesUsed: number;
};

type ExistingMenu = {
  title: string;
  status: string;
  deadlineAt: string | null;
  orderCount: number;
  items: ItemDraft[];
};

/**
 * Manual menu entry.
 *
 * No parsing: Deep types the title, adds items, sets a deadline, publishes.
 * Recently-used items are one tap because the provider's menu repeats heavily —
 * that reuse, not automation, is what keeps this to about half a minute.
 */
export function MenuBuilder({
  dateKey,
  recentItems,
  existing,
}: {
  dateKey: string;
  recentItems: RecentItem[];
  existing: ExistingMenu | null;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [deadlineTime, setDeadlineTime] = useState(
    existing?.deadlineAt
      ? new Date(existing.deadlineAt).toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Kolkata",
        })
      : "10:30",
  );
  const [items, setItems] = useState<ItemDraft[]>(existing?.items ?? []);

  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [priceError, setPriceError] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  /**
   * Only a draft is editable.
   *
   * A published menu is already out for voting, so changing an item or price
   * would move the ground under people who are reading the link right now.
   * Published days stay interactive for closing and re-polling — just not for
   * editing the menu itself.
   */
  const isOutForVoting = existing?.status === "published";
  const isLocked =
    existing?.status === "locked" ||
    existing?.status === "sent_to_provider" ||
    existing?.status === "settled";
  const hasOrders = (existing?.orderCount ?? 0) > 0;

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.unitPricePaise, 0),
    [items],
  );

  // Items already on the menu shouldn't appear as quick-add suggestions.
  const usedNames = useMemo(
    () => new Set(items.map((item) => item.name.trim().toLowerCase())),
    [items],
  );
  const suggestions = recentItems.filter(
    (item) => !usedNames.has(item.name.trim().toLowerCase()),
  );

  function addItem(name: string, pricePaise: number) {
    const trimmed = name.trim();
    if (!trimmed) return;

    if (usedNames.has(trimmed.toLowerCase())) {
      toast.error(`"${trimmed}" is already on the menu.`);
      return;
    }

    setItems((current) => [...current, { name: trimmed, unitPricePaise: pricePaise }]);
    setNewName("");
    setNewPrice("");
    setPriceError(null);
  }

  function handleAddTyped() {
    const paise = parseRupeeInput(newPrice);
    if (paise === null) {
      setPriceError("Enter a price like 40 or 40.50.");
      return;
    }
    if (paise < 0) {
      setPriceError("Price can't be negative.");
      return;
    }
    addItem(newName, paise);
  }

  /**
   * Remove with undo rather than a confirm dialog.
   *
   * A mis-tapped delete that goes unnoticed means the dish is missing from the
   * group's poll, so the action has to be recoverable — but a modal on every
   * removal would slow down the one screen that needs to stay fast.
   */
  function removeItem(index: number) {
    // Capture only the single item, never the array. The toast callback fires
    // after later renders, so restoring a captured *array* would revert every
    // edit made in between; one item plus its index is safe to hold onto.
    const restoredItem = items[index];
    if (!restoredItem) return;

    setItems((current) => current.filter((_, i) => i !== index));

    toast(`Removed ${restoredItem.name}`, {
      // The default ~4s is too short to be a real safety net: a mis-tap is
      // often noticed only after reading back the list.
      duration: 10_000,
      action: {
        label: "Undo",
        onClick: () =>
          setItems((current) => {
            const next = [...current];
            // Splice back at the original position so undo restores order,
            // not just membership.
            next.splice(Math.min(index, next.length), 0, restoredItem);
            return next;
          }),
      },
    });
  }

  async function handleSave(): Promise<boolean> {
    setIsSaving(true);
    const result = await apiPost<{ menuDayId: string }>("/api/admin/menu/save", {
      dateKey,
      title,
      deadlineTime,
      items,
    });
    setIsSaving(false);

    if (!result.ok) {
      // Field messages land on the relevant input where possible; everything
      // else is surfaced as a toast rather than silently dropped.
      toast.error(result.error.fields?.title ?? result.error.message);
      return false;
    }

    toast.success("Menu saved.");
    return true;
  }

  async function handlePublish() {
    setIsPublishing(true);

    // Save first so publishing can never go out with stale items.
    const saved = await handleSave();
    if (!saved) {
      setIsPublishing(false);
      return;
    }

    const result = await apiPost<{ shareUrl: string }>("/api/admin/menu/publish", { dateKey });
    setIsPublishing(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    setShareUrl(result.data.shareUrl);
    toast.success("Menu published. Share the link with the group.");
  }

  /**
   * Close ordering before the deadline.
   *
   * Confirmed because it can't be undone: once closed, nobody can add or
   * change an order, and reopening means running a new round. Deep uses this
   * when the provider asks for counts early.
   */
  async function closeOrderingNow() {
    const ordered = existing?.orderCount ?? 0;
    const confirmed = window.confirm(
      ordered > 0
        ? `Close ordering now? ${ordered} ${ordered === 1 ? "person has" : "people have"} ordered. ` +
            `Nobody will be able to add or change an order after this.`
        : "Close ordering now? Nobody has ordered yet, and no one will be able to after this.",
    );
    if (!confirmed) return;

    setIsClosing(true);
    const result = await apiPost("/api/admin/day/lock", { dateKey });
    setIsClosing(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    toast.success("Ordering closed. Counts are final.");
    window.location.assign(`/admin/today/summary?date=${dateKey}`);
  }

  async function copyShareMessage() {
    const message =
      `🍱 ${title || "Today's menu"}\n` +
      `Order by ${formatTime(new Date(`${dateKey}T${deadlineTime}:00+05:30`))}\n` +
      `${shareUrl}`;

    try {
      await navigator.clipboard.writeText(message);
      toast.success("Copied — paste it in the group.");
    } catch {
      toast.error("Couldn't copy. Select the link and copy it manually.");
    }
  }

  if (isLocked) {
    return (
      <Card>
        <CardHeader
          title={existing?.title || "Today's menu"}
          action={<StatusPill status={existing.status as "locked"} />}
        />
        <CardBody className="space-y-3">
          {/* Each locked state has a different consequence, so they get
              different copy. "Ordering closed" and "already sent to the
              provider" are not the same situation: after sending, a change
              means renegotiating with the provider, not just reopening. */}
          <p className="text-text-muted text-body">
            {existing?.status === "settled"
              ? "This day has been billed in a settlement, so the menu is final."
              : existing?.status === "sent_to_provider"
                ? "Counts have already been sent to the provider, so the menu is locked. If they're short of something, open a new round instead of editing this one."
                : "Ordering has closed for this day, so the menu can no longer be edited."}
          </p>

          <Link
            href={`/admin/today/summary?date=${dateKey}`}
            className="border-line-strong bg-surface text-text hover:bg-surface-raised inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border px-4 text-body font-medium transition-colors"
          >
            See counts for the provider
          </Link>

          {existing?.status === "sent_to_provider" && (
            <Link
              href={`/admin/today/repoll?date=${dateKey}`}
              className="border-line-strong bg-surface text-text hover:bg-surface-raised inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border px-4 text-body font-medium transition-colors"
            >
              Provider is short of something
            </Link>
          )}
        </CardBody>
      </Card>
    );
  }

  // Published: read-only menu, but closing and re-polling are still available.
  if (isOutForVoting) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader
            title={existing?.title || "Today's menu"}
            description={`Out for voting · ${existing?.orderCount ?? 0} ordered so far`}
            action={<StatusPill status="published" />}
          />
          <ul className="divide-line divide-y">
            {items.map((item, index) => (
              <li
                key={`${item.name}-${index}`}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <span className="text-body text-text min-w-0 flex-1 wrap-break-word">
                  {item.name}
                </span>
                <Money paise={item.unitPricePaise} variant="muted" />
              </li>
            ))}
          </ul>
          <CardBody className="border-line border-t">
            <p className="text-text-muted text-body">
              The group is voting on this menu, so it can&rsquo;t be edited. If something needs
              to change, open a new round — that re-asks the people affected and keeps their
              bills correct.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Ordering is open"
            description="Close early if the provider needs counts sooner"
          />
          <CardBody className="space-y-2">
            <Button
              variant="secondary"
              onClick={closeOrderingNow}
              isLoading={isClosing}
              loadingText="Closing…"
              fullWidth
            >
              <Lock className="size-4" aria-hidden />
              Close ordering now
            </Button>
            <p className="text-text-muted text-caption text-center">
              Otherwise it closes automatically at the deadline.
            </p>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href={`/admin/today/summary?date=${dateKey}`}
            className="border-line-strong bg-surface text-text hover:bg-surface-raised inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border px-4 text-body font-medium transition-colors"
          >
            See counts so far
          </Link>
          <Link
            href={`/admin/today/repoll?date=${dateKey}`}
            className="border-line-strong bg-surface text-text hover:bg-surface-raised inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border px-4 text-body font-medium transition-colors"
          >
            Change the menu (new round)
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {hasOrders && (
        <div
          role="status"
          className="border-warning-border bg-warning-subtle flex items-start gap-2 rounded-lg border px-4 py-3"
        >
          <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="text-warning text-body">
            {existing?.orderCount} {existing?.orderCount === 1 ? "person has" : "people have"}{" "}
            already ordered. Editing items now would change what they owe — open a new round
            instead.
          </p>
        </div>
      )}

      <Card>
        <CardHeader
          title="Menu details"
          action={<StatusPill status="draft" />}
        />
        <CardBody className="space-y-4">
          <Field
            label="Menu title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Thursday Special"
            hint="Shown to the group at the top of the poll."
            maxLength={80}
          />
          <Field
            label="Ordering closes at"
            type="time"
            value={deadlineTime}
            onChange={(event) => setDeadlineTime(event.target.value)}
            hint="After this time nobody can add or change an order."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Items"
          description={items.length === 0 ? "Nothing added yet" : `${items.length} item${items.length === 1 ? "" : "s"}`}
        />

        {items.length === 0 ? (
          <CardBody>
            <EmptyState
              title="No items yet"
              description="Add what the provider is serving today. People pick from these when they order."
            />
          </CardBody>
        ) : (
          <ul className="divide-line divide-y">
            {items.map((item, index) => (
              <li key={`${item.name}-${index}`} className="flex items-center gap-3 px-5 py-3">
                <span className="text-body text-text min-w-0 flex-1 wrap-break-word">{item.name}</span>
                <Money paise={item.unitPricePaise} />
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  aria-label={`Remove ${item.name}`}
                  className="text-text-subtle hover:text-danger flex size-11 shrink-0 items-center justify-center rounded-md transition-colors"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <CardBody className="border-line border-t">
          {/* Stacks on phones; the price field stays narrow beside the name
              once there's room for it. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field
                label="Item name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleAddTyped();
                  }
                }}
                placeholder="Paneer sabji"
                maxLength={60}
              />
            </div>
            <div className="sm:w-32">
              <Field
                label="Price (₹)"
                value={newPrice}
                onChange={(event) => {
                  setNewPrice(event.target.value);
                  setPriceError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleAddTyped();
                  }
                }}
                inputMode="decimal"
                placeholder="40"
                error={priceError ?? undefined}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={handleAddTyped}
              disabled={!newName.trim() || !newPrice.trim()}
              className="sm:mb-0"
            >
              <Plus className="size-4" aria-hidden />
              Add
            </Button>
          </div>

          {suggestions.length > 0 && (
            <div className="mt-4">
              <p className="text-label text-text-muted mb-2">Used recently — tap to add</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((item) => (
                  <button
                    key={item.normalizedName}
                    type="button"
                    onClick={() => addItem(item.name, Number(item.unitPricePaise))}
                    className="border-line-strong bg-surface hover:bg-surface-raised text-text flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-label transition-colors"
                  >
                    <Plus className="text-text-subtle size-3.5" aria-hidden />
                    {item.name}
                    <span className="text-text-muted font-mono" data-numeric>
                      {formatPaise(Number(item.unitPricePaise))}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {items.length > 0 && (
        <Card>
          <CardBody className="flex items-center justify-between">
            <span className="text-text-muted text-body">
              {items.length} item{items.length === 1 ? "" : "s"}, priced
            </span>
            <Money paise={total} variant="muted" />
          </CardBody>
        </Card>
      )}

      {shareUrl ? (
        <Card>
          <CardHeader title="Share with the group" description="Paste this into WhatsApp" />
          <CardBody className="space-y-3">
            <p className="bg-surface-raised border-line text-text break-all rounded-md border px-3 py-2 text-label">
              {shareUrl}
            </p>
            <Button onClick={copyShareMessage} fullWidth>
              <Copy className="size-4" aria-hidden />
              Copy message for WhatsApp
            </Button>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            onClick={handleSave}
            isLoading={isSaving}
            loadingText="Saving…"
            disabled={items.length === 0 || isPublishing}
            fullWidth
          >
            <Check className="size-4" aria-hidden />
            Save draft
          </Button>
          {(
            <Button
              onClick={handlePublish}
              isLoading={isPublishing}
              loadingText="Publishing…"
              disabled={items.length === 0 || !title.trim() || isSaving}
              fullWidth
            >
              <Send className="size-4" aria-hidden />
              Publish to group
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
