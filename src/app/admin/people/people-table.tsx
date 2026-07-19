"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Merge, Shield, ShieldOff, UserX, X } from "lucide-react";
import { apiPost } from "@/lib/api/client";
import { canDemoteAdmin, canPromoteToAdmin, type Viewer } from "@/lib/auth/permissions";
import type { AccountStatus } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusKind } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/page-state";
import { MergeDialog } from "./merge-dialog";
import { cn } from "@/lib/cn";

export type PersonRow = {
  id: string;
  name: string;
  email: string;
  accountStatus: AccountStatus;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  createdAt: Date;
  approvedAt: Date | null;
  orderCount: number;
};

const STATUS_TO_PILL: Record<AccountStatus, StatusKind> = {
  pending: "pending",
  approved: "approved",
  inactive: "not_ordered",
  rejected: "rejected",
};

export function PeopleTable({ viewer, people }: { viewer: Viewer; people: PersonRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Tracks which row is mutating so only that row's buttons disable.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mergeSource, setMergeSource] = useState<PersonRow | null>(null);

  async function run(personId: string, action: () => Promise<void>) {
    setBusyId(personId);
    try {
      await action();
    } finally {
      setBusyId(null);
    }
  }

  async function changeStatus(person: PersonRow, status: AccountStatus, successMessage: string) {
    await run(person.id, async () => {
      const result = await apiPost("/api/admin/people/status", { personId: person.id, status });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(successMessage);
      startTransition(() => router.refresh());
    });
  }

  async function changeRole(person: PersonRow, isAdmin: boolean) {
    await run(person.id, async () => {
      const result = await apiPost("/api/admin/people/role", { personId: person.id, isAdmin });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(isAdmin ? `${person.name} is now an admin.` : `${person.name} is no longer an admin.`);
      startTransition(() => router.refresh());
    });
  }

  if (people.length === 0) {
    return (
      <div className="p-5">
        <EmptyState title="No one here yet" description="People appear once they sign up." />
      </div>
    );
  }

  return (
    <>
      <ul className="divide-line divide-y">
        {people.map((person) => {
          const isBusy = busyId === person.id || isPending;
          const isSelf = person.id === viewer.id;

          return (
            <li key={person.id} className="px-5 py-4">
              {/* Stacks on phones and only becomes a row once there is width
                  for it — actions beside a name at 390px overlapped the text
                  and truncated the email the merge tool depends on. */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 sm:flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-body text-text font-medium">{person.name}</span>
                    <StatusPill status={STATUS_TO_PILL[person.accountStatus]} />
                    {person.isSuperAdmin ? (
                      <StatusPill status="settled" label="Owner" />
                    ) : person.isAdmin ? (
                      <StatusPill status="sent_to_provider" label="Admin" />
                    ) : null}
                  </div>
                  {/* break-all, not truncate: a half-shown address can't be
                      matched against its duplicate. */}
                  <p className="text-text-muted text-label mt-1 break-all">{person.email}</p>
                  <p className="text-text-subtle text-caption mt-0.5 whitespace-nowrap">
                    {person.orderCount} order{person.orderCount === 1 ? "" : "s"}
                  </p>
                </div>

                {/* The owner's row is intentionally actionless — their role and
                    status cannot be changed by anyone, including themselves. */}
                {!person.isSuperAdmin && !isSelf && (
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {person.accountStatus === "pending" && (
                      <>
                        <Button
                          size="sm"
                          isLoading={isBusy}
                          onClick={() =>
                            changeStatus(person, "approved", `${person.name} can now order.`)
                          }
                        >
                          <Check className="size-4" aria-hidden />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={isBusy}
                          onClick={() =>
                            changeStatus(person, "rejected", `${person.name} was declined.`)
                          }
                        >
                          <X className="size-4" aria-hidden />
                          Decline
                        </Button>
                      </>
                    )}

                    {person.accountStatus === "approved" && (
                      <>
                        {!person.isAdmin && canPromoteToAdmin(viewer) && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={isBusy}
                            onClick={() => changeRole(person, true)}
                          >
                            <Shield className="size-4" aria-hidden />
                            Make admin
                          </Button>
                        )}
                        {/* Only the owner sees this — regular admins cannot
                            demote, and the server enforces it regardless. */}
                        {person.isAdmin && canDemoteAdmin(viewer) && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={isBusy}
                            onClick={() => changeRole(person, false)}
                          >
                            <ShieldOff className="size-4" aria-hidden />
                            Remove admin
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isBusy}
                          onClick={() =>
                            changeStatus(
                              person,
                              "inactive",
                              `${person.name} can no longer place orders.`,
                            )
                          }
                        >
                          <UserX className="size-4" aria-hidden />
                          Deactivate
                        </Button>
                      </>
                    )}

                    {(person.accountStatus === "inactive" ||
                      person.accountStatus === "rejected") && (
                      <Button
                        size="sm"
                        variant="secondary"
                        isLoading={isBusy}
                        onClick={() =>
                          changeStatus(person, "approved", `${person.name} can order again.`)
                        }
                      >
                        <Check className="size-4" aria-hidden />
                        Reactivate
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isBusy}
                      onClick={() => setMergeSource(person)}
                      title="Merge this duplicate into another account"
                    >
                      <Merge className="size-4" aria-hidden />
                      <span className={cn("sr-only sm:not-sr-only")}>Merge</span>
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {mergeSource && (
        <MergeDialog
          source={mergeSource}
          candidates={people.filter(
            (candidate) => candidate.id !== mergeSource.id && !candidate.isSuperAdmin,
          )}
          onClose={() => setMergeSource(null)}
          onMerged={() => {
            setMergeSource(null);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </>
  );
}
