import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { errors } from "@/server/game/errors";
import { closeTimedOut } from "@/server/game/runs";
import { api, json, readJson } from "@/server/http";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;

/** The waterskin ran dry: close the open question { position } with 0 km. */
export const POST = api(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw errors.notFound();
  const body = await readJson<{ position: number }>(req);
  return json(await closeTimedOut(getDb(), user.id, id, Number(body.position)));
});
