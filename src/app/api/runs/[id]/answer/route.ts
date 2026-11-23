import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { errors } from "@/server/game/errors";
import { rateLimit } from "@/server/game/ratelimit";
import { MAX_ANSWER_CHARS, submitAnswer } from "@/server/game/runs";
import { api, json, readJson } from "@/server/http";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;

/** Submit { position, answer }. Scored on the server; one submission per question. */
export const POST = api(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw errors.notFound();
  const body = await readJson<{ position: number; answer: string }>(req);
  const position = Number(body.position);
  const answer = typeof body.answer === "string" ? body.answer : "";
  if (answer.length > MAX_ANSWER_CHARS * 4) throw errors.badInput("الإجابة طويلة جدًا.");
  const db = getDb();
  await rateLimit(db, `u:${user.id}:answer`, 30);
  return json(await submitAnswer(db, user.id, id, position, answer));
});
