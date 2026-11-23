import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { pruneRateLimits } from "@/server/game/ratelimit";
import { finalizeDueJourneys } from "@/server/scoring/finalize";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Nightly (Vercel Cron, see vercel.json): make finished days final. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const finalized = await finalizeDueJourneys(db);
  await pruneRateLimits(db);
  return NextResponse.json({ finalized });
}
