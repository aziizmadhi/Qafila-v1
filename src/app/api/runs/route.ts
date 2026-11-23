import { isIsoDate } from "@/lib/time";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { errors } from "@/server/game/errors";
import { rateLimit } from "@/server/game/ratelimit";
import { startRun } from "@/server/game/runs";
import { api, json, readJson } from "@/server/http";

export const dynamic = "force-dynamic";

/** Start or resume a run: { mode: "daily" } or { mode: "unlimited", date: "YYYY-MM-DD" }. */
export const POST = api(async (req: Request) => {
  const user = await requireUser();
  const body = await readJson<{ mode: string; date: string }>(req);
  const mode = body.mode === "unlimited" ? "unlimited" : body.mode === "daily" ? "daily" : null;
  if (!mode) throw errors.badInput();
  if (mode === "unlimited" && (typeof body.date !== "string" || !isIsoDate(body.date))) throw errors.badInput();
  const db = getDb();
  await rateLimit(db, `u:${user.id}:start`, 20);
  return json(await startRun(db, user.id, { mode, date: body.date }));
});
