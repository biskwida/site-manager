// app/auth/callback/route.ts — the return point of the email link and Google sign-in (src/server/auth-callback.ts).
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleAuthCallback } from "@/src/server/auth-callback";
import { createSessionClient } from "@/src/server/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const supabase = await createSessionClient();
  if (!supabase) return new Response(null, { status: 303, headers: { Location: new URL("/login?error=1", url.origin).toString() } });
  const deps = await getServerDeps((fn) => after(fn));
  return handleAuthCallback(url, { auth: supabase.auth, store: deps.store });
}
