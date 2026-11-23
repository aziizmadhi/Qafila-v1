import { createHash } from "node:crypto";
import type { Db } from "@/server/db";
import { errors } from "./errors";

/** Fixed-window counter in Postgres. Throws a 429 GameError when over the limit. */
export async function rateLimit(db: Db, key: string, limit: number, windowSeconds = 60): Promise<void> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const [row] = await db<{ hits: number }[]>`
    insert into rate_limits (key, window_start, hits) values (${key}, ${windowStart}, 1)
    on conflict (key, window_start) do update set hits = rate_limits.hits + 1
    returning hits`;
  if ((row?.hits ?? 0) > limit) throw errors.rateLimited();
}

/** IPs are never stored: only a salted, truncated hash is used as a rate-limit key. */
export function hashIp(ip: string | null): string {
  const salt = process.env.RATE_LIMIT_SALT ?? "qafila";
  return createHash("sha256").update(`${salt}:${ip ?? "unknown"}`).digest("hex").slice(0, 24);
}

export async function pruneRateLimits(db: Db): Promise<void> {
  await db`delete from rate_limits where window_start < now() - interval '1 day'`;
}
