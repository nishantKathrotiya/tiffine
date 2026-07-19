import { Clock, Info, XCircle } from "lucide-react";
import { getOrderingBlockedReason, type Viewer } from "@/lib/auth/permissions";
import { cn } from "@/lib/cn";

/**
 * Explains why a viewer cannot currently order.
 *
 * Rendered above the ordering UI so the reason sits next to the thing that is
 * disabled — a person should never be left guessing why a button is greyed out.
 */
export function AccountStatusBanner({ viewer }: { viewer: Viewer }) {
  const reason = getOrderingBlockedReason(viewer);
  if (!reason) return null;

  const tone =
    viewer.accountStatus === "pending"
      ? { className: "border-warning-border bg-warning-subtle text-warning", Icon: Clock }
      : viewer.accountStatus === "inactive"
        ? { className: "border-line bg-surface-raised text-text-muted", Icon: Info }
        : { className: "border-danger-border bg-danger-subtle text-danger", Icon: XCircle };

  return (
    <div
      role="status"
      className={cn("flex items-start gap-3 rounded-lg border px-4 py-3", tone.className)}
    >
      <tone.Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div>
        <p className="text-label font-medium">
          {viewer.accountStatus === "pending"
            ? "Waiting for approval"
            : viewer.accountStatus === "inactive"
              ? "Account deactivated"
              : "Account declined"}
        </p>
        <p className="text-body mt-0.5 opacity-90">{reason}</p>
      </div>
    </div>
  );
}
