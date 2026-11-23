import { NextResponse } from "next/server";
import type { ApiErrorBody } from "@/lib/api-types";
import { getDb } from "@/server/db";
import { GameError } from "@/server/game/errors";
import { hashIp, rateLimit } from "@/server/game/ratelimit";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export function json<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof GameError) {
    return NextResponse.json<ApiErrorBody>({ error: e.message, code: e.code }, { status: e.status, headers: NO_STORE });
  }
  console.error(e);
  return NextResponse.json<ApiErrorBody>(
    { error: "حدث خطأ غير متوقع. حاول مرة أخرى.", code: "server_error" },
    { status: 500, headers: NO_STORE },
  );
}

export const IP_LIMIT_PER_MINUTE = 240;

/** The rate-limit key for a request's client IP (salted hash, never the IP itself). */
export function ipKey(req: Request): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || req.headers.get("x-real-ip");
  return `ip:${hashIp(ip)}`;
}

/**
 * Wrap a route handler: JSON errors, and a per-IP limit on every API call.
 * `ipLimitInHandler`: the handler applies the IP limit itself (the answer
 * route does it inside its single database call).
 */
export function api<A extends unknown[]>(
  handler: (req: Request, ...rest: A) => Promise<NextResponse>,
  opts: { ipLimitPerMinute?: number; ipLimitInHandler?: boolean } = {},
) {
  return async (req: Request, ...rest: A): Promise<NextResponse> => {
    try {
      if (!opts.ipLimitInHandler) await rateLimit(getDb(), ipKey(req), opts.ipLimitPerMinute ?? IP_LIMIT_PER_MINUTE);
      return await handler(req, ...rest);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function readJson<T>(req: Request): Promise<Partial<T>> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === "object" ? (body as Partial<T>) : {};
  } catch {
    return {};
  }
}
