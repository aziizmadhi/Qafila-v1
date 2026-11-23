import { cookies } from "next/headers";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { errors } from "@/server/game/errors";
import { createMergeTicket } from "@/server/game/profile";
import { rateLimit } from "@/server/game/ratelimit";
import { api, json } from "@/server/http";

export const dynamic = "force-dynamic";
const MERGE_COOKIE = "qafila_merge";

/**
 * Called by an anonymous player right before signing in to an existing account.
 * The httpOnly cookie proves, on the magic-link callback, which anonymous
 * account to merge from (D5).
 */
export const POST = api(async () => {
  const user = await requireUser();
  if (!user.isAnonymous) throw errors.badInput();
  const db = getDb();
  await rateLimit(db, `u:${user.id}:merge`, 5);
  const ticket = await createMergeTicket(db, user.id);
  const store = await cookies();
  store.set(MERGE_COOKIE, ticket, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 2 * 60 * 60,
  });
  return json({ ok: true });
});
