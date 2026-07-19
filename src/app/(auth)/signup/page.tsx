import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignUpForm } from "./sign-up-form";
import { getViewer } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Create account · Tiffine" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (await getViewer()) redirect(safeNext);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <div className="mb-8">
        <h1 className="text-display text-text">Join the lunch group</h1>
        <p className="text-text-muted text-body mt-1">
          An admin approves new accounts before you can place orders.
        </p>
      </div>

      <SignUpForm next={safeNext} />

      <p className="text-text-muted text-body mt-6 text-center">
        Already have an account?{" "}
        <Link href="/signin" className="text-primary font-medium underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </main>
  );
}
