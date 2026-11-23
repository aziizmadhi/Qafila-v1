import { NextResponse } from "next/server";
import { isCategory } from "@/lib/categories";
import { getDb } from "@/server/db";
import { errors } from "@/server/game/errors";
import { suggestionPools } from "@/server/game/suggestions";
import { api } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/suggestions?categories=geography,history
 * → { pools: { geography: string[], history: string[] } }
 *
 * Only category names are accepted: the pools can't depend on a question.
 * Not personal, so no session is needed; the per-IP limit applies.
 */
export const GET = api(async (req: Request) => {
  const list = (new URL(req.url).searchParams.get("categories") ?? "").split(",").filter(Boolean);
  if (list.length === 0 || list.length > 8 || !list.every(isCategory)) throw errors.badInput();
  const pools = await suggestionPools(getDb(), list);
  return NextResponse.json({ pools }, { headers: { "Cache-Control": "private, max-age=600" } });
});
