// src/server/auth-callback.ts
// Server-only. GET /auth/callback, as a function of its dependencies: finish a sign-in, claim account invites for the user's
// email, and redirect (only ever inside this site).
import { safeNext } from "../auth/next";
import type { Store } from "../store/types";

interface CallbackUser {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
}
type AuthResult = Promise<{ data: { user: CallbackUser | null }; error: unknown }>;

/** The slice of Supabase's auth client this needs. */
export interface AuthLike {
  exchangeCodeForSession(code: string): AuthResult;
  verifyOtp(params: { token_hash: string; type: "magiclink" | "email" }): AuthResult;
}

const redirect = (url: URL, path: string) => new Response(null, { status: 303, headers: { Location: new URL(path, url.origin).toString() } });

/**
 * `?code=` (the email link and Google, PKCE) or `?token_hash=&type=magiclink|email` (the link account:invite mails, made by the
 * admin API, which has no code verifier). On success: claimAccountInvites(user.id, user.email), then redirect to `next` when it is a
 * same-origin path, else /dashboard. Any failure goes to /login?error=1. Claims need the email Supabase has confirmed; a claim that
 * fails does not undo the sign-in, the invite stays open for the next one.
 */
export async function handleAuthCallback(url: URL, deps: { auth: AuthLike; store: Store }): Promise<Response> {
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  let user: CallbackUser | null = null;
  try {
    if (code) {
      const r = await deps.auth.exchangeCodeForSession(code);
      user = r.error ? null : r.data.user;
    } else if (tokenHash && (type === "magiclink" || type === "email")) {
      const r = await deps.auth.verifyOtp({ token_hash: tokenHash, type });
      user = r.error ? null : r.data.user;
    }
  } catch {
    user = null;
  }
  if (!user) return redirect(url, "/login?error=1");
  if (user.email && user.email_confirmed_at) {
    try {
      await deps.store.claimAccountInvites(user.id, user.email);
    } catch (e) {
      console.error(`auth callback: claiming account invites failed: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  return redirect(url, safeNext(url.searchParams.get("next")));
}
