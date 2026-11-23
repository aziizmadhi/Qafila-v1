import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { errors } from "@/server/game/errors";
import { MAX_ANSWER_CHARS, submitAnswer } from "@/server/game/runs";
import { IP_LIMIT_PER_MINUTE, api, ipKey, json, readJson } from "@/server/http";
import { ServerTiming } from "@/server/timing";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Submit { position, answer }. Scored on the server in one database call
 * (game.submit), which also applies the per-IP limit and the retry limits.
 * Wrong answers keep the question open; the first correct answer closes it.
 */
export const POST = api(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const timing = new ServerTiming("answer");
    const user = await timing.measure("auth", requireUser);
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw errors.notFound();
    const body = await readJson<{ position: number; answer: string }>(req);
    const position = Number(body.position);
    const answer = typeof body.answer === "string" ? body.answer : "";
    if (answer.length > MAX_ANSWER_CHARS * 4) throw errors.badInput("الإجابة طويلة جدًا.");
    const result = await timing.measure("db", () =>
      submitAnswer(getDb(), user.id, id, position, answer, new Date(), {
        ipKey: ipKey(req),
        ipLimit: IP_LIMIT_PER_MINUTE,
      }),
    );
    return timing.apply(json(result));
  },
  { ipLimitInHandler: true },
);
