import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/server/auth";
import { getDb } from "@/server/db";
import { mergeFromTicket } from "@/server/game/profile";

export const dynamic = "force-dynamic";
const MERGE_COOKIE = "qafila_merge";

function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/profile";
}

/**
 * Magic-link landing page. Supports the PKCE `code` flow (default email
 * templates, same browser) and the `token_hash` flow (custom templates, any
 * device). Then merges anonymous progress if a merge ticket is present.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const supabase = await getServerSupabase();

  let ok = false;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  }
  if (!ok) return NextResponse.redirect(new URL("/profile?auth=failed", url.origin));

  const store = await cookies();
  const ticket = store.get(MERGE_COOKIE)?.value;
  let merged = "";
  if (ticket) {
    const { data } = await supabase.auth.getClaims();
    if (data?.claims?.sub && /^[0-9a-f-]{36}$/i.test(ticket)) {
      const r = await mergeFromTicket(getDb(), ticket, data.claims.sub);
      merged = `&merged=${r.moved}`;
    }
    store.delete(MERGE_COOKIE);
  }
  return NextResponse.redirect(new URL(`${next}?auth=ok${merged}`, url.origin));
}
