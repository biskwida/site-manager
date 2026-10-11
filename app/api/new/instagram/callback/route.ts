// app/api/new/instagram/callback/route.ts — Instagram's OAuth redirect: checks state, nonce and draft cookie, reads the photos
// once with a short-lived token that is then dropped, and sends the owner back into the wizard. The one registered redirect URI.
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleInstagramCallback } from "@/src/server/instagram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleInstagramCallback(req, { store: deps.store, config: deps.config, fetch: deps.fetch, now: () => new Date() });
}
