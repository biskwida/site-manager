// src/server/session.ts
// Server-only. The signed-in account of the current request (Supabase Auth cookies), for server components and route handlers.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export interface SessionUser {
  id: string;
  email: string;
}

/** The public Supabase env, or null when it is missing or the offline memory mode is on (no sign-in is possible then). */
export function supabasePublicEnv(env: Record<string, string | undefined> = process.env): { url: string; anonKey: string } | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey || env.SITE_MANAGER_STORE === "memory") return null;
  return { url, anonKey };
}

/**
 * A Supabase Auth client bound to this request's cookies (the @supabase/ssr pattern for the app router). Null without the public
 * env. A server component cannot write cookies: that setAll failure is swallowed (route handlers, where sign-in happens, can).
 */
export async function createSessionClient() {
  const env = supabasePublicEnv();
  if (!env) return null;
  const jar = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) jar.set(name, value, options);
        } catch {
          // Called from a server component: the next route handler or proxy refresh writes them.
        }
      },
    },
  });
}

/**
 * The verified signed-in account ({ id, email }) or null. Never throws. Null without Supabase env (memory/test mode), without a
 * session, when the token does not verify (getUser asks Supabase, it does not trust the cookie), or for a user without an email.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const supabase = await createSessionClient();
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user?.email) return null;
    return { id: data.user.id, email: data.user.email };
  } catch {
    return null;
  }
}
