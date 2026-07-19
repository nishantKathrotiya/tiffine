import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { isActiveAdmin } from "@/lib/auth/permissions";
import { getPendingCount } from "@/lib/services/people-service";
import { searchMembers } from "@/lib/services/member-service";
import { AppShell } from "@/components/app-shell";
import { MemberDirectory } from "./member-directory";

export const metadata: Metadata = { title: "Members · Tiffine" };

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin?next=/admin/members");
  if (!isActiveAdmin(viewer)) redirect("/");

  const { q } = await searchParams;

  // Filtering happens in SQL, so the URL is shareable and the result set stays
  // correct however the group grows.
  const [members, pendingCount] = await Promise.all([
    searchMembers(viewer, q),
    getPendingCount(viewer),
  ]);

  return (
    <AppShell viewer={viewer} pendingCount={pendingCount}>
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <header>
          <h1 className="text-display text-text">Members</h1>
          <p className="text-text-muted text-body mt-1">
            Search anyone to see everything they&rsquo;ve ordered.
          </p>
        </header>

        <MemberDirectory members={members} initialQuery={q ?? ""} />
      </div>
    </AppShell>
  );
}
