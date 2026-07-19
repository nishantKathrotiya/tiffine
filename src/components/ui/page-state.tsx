import { AlertCircle, Inbox } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/cn";

/**
 * Standard loading / error / empty rendering.
 *
 * Every data-driven view routes through this, so no screen can quietly ship
 * with a blank panel or a raw exception string. If a view needs a state this
 * doesn't cover, add it here rather than hand-rolling it locally.
 */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-sm", className)} aria-hidden />;
}

/**
 * Skeletons mirror the real layout rather than showing a spinner, so content
 * arriving does not shift the page under a thumb that is already reaching.
 */
export function LoadingState({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("space-y-3", className)}
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="bg-surface border-line flex items-center gap-4 rounded-lg border px-5 py-4"
        >
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-5 w-16 shrink-0" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/**
 * Errors state what happened in plain language and always offer a way forward.
 * `message` is the human-friendly text from the API envelope.
 */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  className,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "border-danger-border bg-danger-subtle flex flex-col items-center rounded-lg border px-6 py-8 text-center",
        className,
      )}
    >
      <AlertCircle className="text-danger size-6" aria-hidden />
      <h3 className="text-title text-text mt-3">{title}</h3>
      <p className="text-text-muted text-body mt-1 max-w-sm">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-4">
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * Empty states are actionable, never a bare "No data" — they say what is
 * missing and offer the action that fixes it.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-line bg-surface flex flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      <div className="text-text-subtle" aria-hidden>
        {icon ?? <Inbox className="size-8" />}
      </div>
      <h3 className="text-title text-text mt-3">{title}</h3>
      {description && (
        <p className="text-text-muted text-body mt-1 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

type PageStateProps<T> = {
  isLoading: boolean;
  error?: { message: string } | null;
  data: T | null | undefined;
  onRetry?: () => void;
  loadingRows?: number;
  empty: { title: string; description?: string; icon?: React.ReactNode; action?: React.ReactNode };
  children: (data: NonNullable<T>) => React.ReactNode;
};

/**
 * Resolves the four states in a fixed order and hands `children` data that is
 * guaranteed non-empty, so views never guard for null themselves.
 */
export function PageState<T>({
  isLoading,
  error,
  data,
  onRetry,
  loadingRows,
  empty,
  children,
}: PageStateProps<T>) {
  if (isLoading) return <LoadingState rows={loadingRows} />;
  if (error) return <ErrorState message={error.message} onRetry={onRetry} />;

  const isEmpty =
    data === null || data === undefined || (Array.isArray(data) && data.length === 0);
  if (isEmpty) return <EmptyState {...empty} />;

  return <>{children(data as NonNullable<T>)}</>;
}
