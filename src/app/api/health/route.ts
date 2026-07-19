import { NextResponse } from "next/server";

/**
 * Liveness probe and keep-alive target.
 *
 * Render's free web service sleeps after ~15 minutes idle and takes ~50s to
 * wake. That cold start would land at exactly the wrong moment — someone taps
 * the WhatsApp link at 10:25 with five minutes to order. A scheduled ping to
 * this route during working hours keeps the instance warm.
 *
 * Deliberately does NOT touch the database: it runs every few minutes, and
 * waking Neon's compute on each ping would burn the free tier's hours for no
 * benefit. Warming the *web* process is the whole job.
 *
 * Unauthenticated on purpose — it exposes nothing and must stay reachable by
 * any uptime checker.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { ok: true, data: { status: "healthy" } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
