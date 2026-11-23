import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { errors } from "@/server/game/errors";
import { rateLimit } from "@/server/game/ratelimit";
import { beginRun } from "@/server/game/runs";
import { api, json } from "@/server/http";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;

/** Begin the journey: question 1's clock starts now; all seven question texts are returned. */
export const POST = api(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw errors.notFound();
  const db = getDb();
  await rateLimit(db, `u:${user.id}:begin`, 30);
  return json(await beginRun(db, user.id, id));
});
