"use client";
import { getBrowserSupabase } from "@/lib/supabase/browser";

let ready: Promise<void> | null = null;

/**
 * Everyone can play immediately: if there is no session yet, sign in
 * anonymously. Upgrading to email later keeps the same user id.
 */
export function ensureSession(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const sb = getBrowserSupabase();
      const { data } = await sb.auth.getSession();
      if (data.session) return;
      const { error } = await sb.auth.signInAnonymously();
      if (error) throw error;
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export function resetSession(): void {
  ready = null;
}
