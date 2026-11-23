import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseConfig } from "@/lib/supabase/config";
import { errors } from "@/server/game/errors";

export interface AuthUser {
  id: string;
  isAnonymous: boolean;
  email: string | null;
}

/** Supabase client bound to the request cookies (route handlers may refresh them). */
export async function getServerSupabase(): Promise<SupabaseClient> {
  const { url, anonKey } = supabaseConfig();
  const store = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          /* called from a server component: cookies are read-only there */
        }
      },
    },
  });
}

/** The verified user for this request, or a 401 GameError. */
export async function requireUser(): Promise<AuthUser> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) throw errors.unauthorized();
  return {
    id: claims.sub,
    isAnonymous: claims.is_anonymous === true,
    email: typeof claims.email === "string" && claims.email !== "" ? claims.email : null,
  };
}
