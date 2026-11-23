import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { listPastJourneys } from "@/server/game/profile";
import { api, json } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = api(async () => {
  const user = await requireUser();
  return json(await listPastJourneys(getDb(), user.id));
});
