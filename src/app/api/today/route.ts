import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { getToday } from "@/server/game/profile";
import { api, json } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = api(async () => {
  const user = await requireUser();
  return json(await getToday(getDb(), user.id));
});
