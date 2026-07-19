"use client";

import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  /**
   * Shows a spinner and disables the button. Every mutating action must pass
   * this while in flight — it is the guard against double-submitting an order
   * or committing a settlement run twice.
   */
  isLoading?: boolean;
  loadingText?: string;
  fullWidth?: boolean;
};

const VARIANTS = {
  primary:
    "bg-primary text-text-on-primary hover:bg-primary-hover border border-transparent",
  secondary:
    "bg-surface text-text border border-line-strong hover:bg-surface-raised",
  ghost: "bg-transparent text-text-muted hover:text-text hover:bg-surface-raised border border-transparent",
  danger: "bg-danger text-white hover:opacity-90 border border-transparent",
} as const;

/* Minimum height 44px on md/lg — the accessible tap target on a phone. */
const SIZES = {
  sm: "min-h-9 px-3 text-label rounded-sm",
  md: "min-h-11 px-4 text-body rounded-md",
  lg: "min-h-13 px-6 text-body font-medium rounded-md",
} as const;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    isLoading = false,
    loadingText,
    fullWidth = false,
    disabled,
    className,
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      // Disabled while loading so a double-tap cannot fire two mutations.
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium",
        "transition-colors duration-150",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {isLoading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {isLoading && loadingText ? loadingText : children}
    </button>
  );
});
