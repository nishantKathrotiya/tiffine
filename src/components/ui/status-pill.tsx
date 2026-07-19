import { cn } from "@/lib/cn";

/**
 * Every status in the app, in one place.
 *
 * Orders, cancellation requests, payments and menu days all render through this
 * map, so a `pending` payment and a `pending` cancellation are visually
 * identical everywhere without anyone having to remember to match them.
 */
export type StatusKind =
  // menu day
  | "draft"
  | "published"
  | "locked"
  | "sent_to_provider"
  | "settled"
  // order
  | "ordered"
  | "not_ordered"
  | "cancelled"
  // cancellation request
  | "pending"
  | "approved"
  | "rejected"
  // payment
  | "paid"
  | "unpaid"
  | "waived";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const STATUS_CONFIG: Record<StatusKind, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  published: { label: "Open for orders", tone: "primary" },
  locked: { label: "Closed", tone: "warning" },
  sent_to_provider: { label: "Sent to provider", tone: "info" },
  settled: { label: "Settled", tone: "success" },

  ordered: { label: "Ordered", tone: "success" },
  not_ordered: { label: "Not ordered", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },

  pending: { label: "Pending", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },

  paid: { label: "Paid", tone: "success" },
  unpaid: { label: "Unpaid", tone: "warning" },
  waived: { label: "Waived", tone: "neutral" },
};

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-surface-raised text-text-muted border-line",
  primary: "bg-primary-subtle text-primary border-primary-border",
  success: "bg-success-subtle text-success border-success-border",
  warning: "bg-warning-subtle text-warning border-warning-border",
  danger: "bg-danger-subtle text-danger border-danger-border",
  info: "bg-info-subtle text-info border-info-border",
};

export function StatusPill({
  status,
  label,
  className,
}: {
  status: StatusKind;
  /** Override the default label; the tone still comes from the status. */
  label?: string;
  className?: string;
}) {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        "text-caption font-medium whitespace-nowrap",
        TONE_CLASSES[config.tone],
        className,
      )}
    >
      {label ?? config.label}
    </span>
  );
}

export function getStatusLabel(status: StatusKind): string {
  return STATUS_CONFIG[status].label;
}
