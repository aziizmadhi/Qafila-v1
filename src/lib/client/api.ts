"use client";
import type {
  AnswerResult,
  ApiErrorBody,
  PastJourney,
  ProfileInfo,
  RunResults,
  RunState,
  TodayInfo,
} from "@/lib/api-types";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { ensureSession } from "./session";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  try {
    await ensureSession();
  } catch {
    throw new ApiError(0, "auth", "تعذّر بدء الجلسة. تحقق من اتصالك وحاول مجددًا.");
  }
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network", "لا يوجد اتصال بالإنترنت.");
  }
  if (res.status === 401 && !retried) {
    await getBrowserSupabase().auth.refreshSession();
    return call<T>(path, init, true);
  }
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.code ?? "error", body?.error ?? "حدث خطأ. حاول مرة أخرى.");
  }
  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  call<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  today: () => call<TodayInfo>("/api/today"),
  startDaily: () => post<RunState>("/api/runs", { mode: "daily" }),
  startUnlimited: (date: string) => post<RunState>("/api/runs", { mode: "unlimited", date }),
  run: (id: string) => call<RunState>(`/api/runs/${id}`),
  next: (id: string) => post<RunState>(`/api/runs/${id}/next`),
  answer: (id: string, position: number, answer: string) =>
    post<AnswerResult>(`/api/runs/${id}/answer`, { position, answer }),
  results: (id: string) => call<RunResults>(`/api/runs/${id}/results`),
  journeys: () => call<PastJourney[]>("/api/journeys"),
  me: () => call<ProfileInfo>("/api/me"),
  mergeTicket: () => post<{ ok: true }>("/api/account/merge-ticket"),
};
