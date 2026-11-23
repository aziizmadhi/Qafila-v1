import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { errors } from "@/server/game/errors";
import { rateLimit } from "@/server/game/ratelimit";
import { serveNext } from "@/server/game/runs";
import { api, json } from "@/server/http";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;

/** Serve the next question; its 30-second clock starts now, on the server. */
export const POST = api(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw errors.notFound();
  const db = getDb();
  await rateLimit(db, `u:${user.id}:next`, 30);
  return json(await serveNext(db, user.id, id));
});
