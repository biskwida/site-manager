// app/login/sign-in.ts — the two Supabase Auth calls the /login form makes, in the browser. Both return where they go through
// callbackUrl (a sanitised same-origin next); neither throws.
import { createBrowserClient } from "@supabase/ssr";
import { callbackUrl } from "@/src/auth/next";

function browserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createBrowserClient(url, key) : null;
}

/** Emails a sign-in link (PKCE: it must be opened in this browser). */
export async function sendEmailLink(o: { email: string; origin: string; next: string }): Promise<{ ok: boolean }> {
  try {
    const supabase = browserClient();
    if (!supabase) return { ok: false };
    const { error } = await supabase.auth.signInWithOtp({ email: o.email.trim(), options: { emailRedirectTo: callbackUrl(o.origin, o.next) } });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/** Starts the Google redirect; ok means the redirect began. */
export async function startGoogle(o: { origin: string; next: string }): Promise<{ ok: boolean }> {
  try {
    const supabase = browserClient();
    if (!supabase) return { ok: false };
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callbackUrl(o.origin, o.next) } });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
