import { NextResponse } from "next/server";

/**
 * Liveness probe.
 *
 * Used to confirm a deploy is serving, and as the target for an uptime monitor
 * if one is ever added. Vercel's serverless functions don't idle-sleep, so no
 * keep-alive ping is required there; a host that does sleep (Render's free web
 * service, for instance) would need one pointed here.
 *
 * Deliberately does NOT touch the database: an uptime check runs frequently,
 * and waking Neon's compute on each ping would burn free-tier hours for no
 * benefit. Confirming the *web* process responds is the whole job.
 *
 * Unauthenticated on purpose — it exposes nothing and must stay reachable by
 * any checker.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { ok: true, data: { status: "healthy" } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
