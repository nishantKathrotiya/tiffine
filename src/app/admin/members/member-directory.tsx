"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Search, Users, X } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import { Money } from "@/components/ui/money";
import { StatusPill, type StatusKind } from "@/components/ui/status-pill";

type Member = {
  id: string;
  name: string;
  email: string;
  accountStatus: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  orderCount: number;
  lifetimePaise: number;
  outstandingPaise: number;
};

const STATUS_PILL: Record<string, StatusKind> = {
  pending: "pending",
  approved: "approved",
  inactive: "not_ordered",
  rejected: "rejected",
};

/**
 * Searchable member directory.
 *
 * The query lives in the URL so a filtered view can be shared or reloaded, and
 * filtering runs in SQL rather than over a client-side array.
 */
export function MemberDirectory({
  members,
  initialQuery,
}: {
  members: Member[];
  initialQuery: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(initialQuery);

  // Debounced so typing doesn't fire a request per keystroke, but the URL
  // still ends up reflecting what's on screen.
  useEffect(() => {
    if (query === initialQuery) return;

    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      startTransition(() => {
        router.replace(params.toString() ? `/admin/members?${params}` : "/admin/members");
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [query, initialQuery, router]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          className="text-text-subtle pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or email"
          aria-label="Search members"
          className="border-line-strong bg-surface text-text placeholder:text-text-subtle min-h-11 w-full rounded-md border pl-9 pr-9 text-body"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="text-text-subtle hover:text-text absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      <Card>
        <CardHeader
          title="Everyone"
          description={
            isPending
              ? "Searching…"
              : `${members.length} ${members.length === 1 ? "person" : "people"}${initialQuery ? ` matching “${initialQuery}”` : ""}`
          }
        />

        {members.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Users className="size-8" />}
              title={initialQuery ? "Nobody matches that" : "No members yet"}
              description={
                initialQuery
                  ? "Try part of a name or email instead."
                  : "People appear here once they sign up."
              }
            />
          </CardBody>
        ) : (
          <ul className="divide-line divide-y">
            {members.map((member) => (
              <li key={member.id}>
                <Link
                  href={`/admin/members/${member.id}`}
                  className="hover:bg-surface-raised flex items-center gap-3 px-5 py-4 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-body text-text font-medium">{member.name}</span>
                      <StatusPill status={STATUS_PILL[member.accountStatus] ?? "not_ordered"} />
                      {member.isSuperAdmin ? (
                        <StatusPill status="settled" label="Owner" />
                      ) : member.isAdmin ? (
                        <StatusPill status="sent_to_provider" label="Admin" />
                      ) : null}
                    </div>
                    <p className="text-text-muted text-label mt-0.5 break-all">{member.email}</p>
                    <p className="text-text-subtle text-caption mt-0.5">
                      {member.orderCount} order{member.orderCount === 1 ? "" : "s"} ·{" "}
                      <Money paise={member.lifetimePaise} variant="muted" className="text-caption" />{" "}
                      lifetime
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    {member.outstandingPaise > 0 ? (
                      <>
                        <Money paise={member.outstandingPaise} />
                        <p className="text-text-subtle text-caption mt-0.5">owed</p>
                      </>
                    ) : (
                      <span className="text-text-subtle text-caption">settled up</span>
                    )}
                  </div>

                  <ChevronRight className="text-text-subtle size-4 shrink-0" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
