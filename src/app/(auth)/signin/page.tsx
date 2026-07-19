import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "./sign-in-form";
import { getViewer } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sign in · Tiffine" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Only accept internal paths — an open redirect would let a crafted link
  // bounce someone to another site after they authenticate.
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  // Already signed in — no reason to show the form again.
  if (await getViewer()) redirect(safeNext);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <div className="mb-8">
        <h1 className="text-display text-text">Welcome back</h1>
        <p className="text-text-muted text-body mt-1">Sign in to place your tiffin order.</p>
      </div>

      <SignInForm next={safeNext} />

      <p className="text-text-muted text-body mt-6 text-center">
        New here?{" "}
        <Link href="/signup" className="text-primary font-medium underline underline-offset-2">
          Create an account
        </Link>
      </p>
    </main>
  );
}
