import { formatPaise, type Paise } from "@/lib/money";
import { cn } from "@/lib/cn";

type MoneyProps = {
  paise: Paise;
  /** Emphasis level. `total` is for the figure a person actually owes. */
  variant?: "default" | "muted" | "total";
  /** Always show paise, even for whole rupees. Use in settlement tables. */
  forceDecimals?: boolean;
  /** Render "+₹40" for positive values — used for reconciliation deltas. */
  showSign?: boolean;
  className?: string;
};

/**
 * The single component for rendering any rupee amount.
 *
 * Money is never formatted inline anywhere else — one implementation means
 * grouping, decimals, and tabular alignment cannot drift between the ordering
 * screen and the settlement table.
 */
export function Money({
  paise,
  variant = "default",
  forceDecimals = false,
  showSign = false,
  className,
}: MoneyProps) {
  const formatted = formatPaise(paise, { forceDecimals });
  const sign = showSign && paise > 0 ? "+" : "";

  return (
    <span
      data-numeric
      className={cn(
        "font-mono whitespace-nowrap",
        variant === "default" && "text-text",
        variant === "muted" && "text-text-muted",
        variant === "total" && "text-text text-title font-semibold",
        className,
      )}
    >
      {sign}
      {formatted}
    </span>
  );
}
