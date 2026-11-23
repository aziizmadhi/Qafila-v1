import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { errors } from "@/server/game/errors";
import { getRunState } from "@/server/game/runs";
import { api, json } from "@/server/http";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;

export const GET = api(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw errors.notFound();
  return json(await getRunState(getDb(), user.id, id));
});
