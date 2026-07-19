"use client";

import { forwardRef, useId } from "react";
import { cn } from "@/lib/cn";

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  /** Server or client validation message for this field. */
  error?: string;
  hint?: string;
};

/**
 * Labelled text input with inline error rendering.
 *
 * The error is wired via aria-describedby and aria-invalid so screen readers
 * announce it, rather than it being visible styling only.
 */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, className, id, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className="text-label text-text block">
        {label}
      </label>

      <input
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(error && errorId, hint && !error && hintId) || undefined}
        className={cn(
          "bg-surface text-text w-full rounded-md border px-3",
          "min-h-11 text-body",
          "placeholder:text-text-subtle",
          "disabled:cursor-not-allowed disabled:opacity-60",
          error ? "border-danger" : "border-line-strong",
          className,
        )}
        {...props}
      />

      {hint && !error && (
        <p id={hintId} className="text-caption text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-caption text-danger">
          {error}
        </p>
      )}
    </div>
  );
});
