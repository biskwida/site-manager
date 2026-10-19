// Facebook Login's redirect for posting: checks state + nonce cookie, stores the Page (or shows the chooser), back to the dashboard.
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { getSessionUser } from "@/src/server/session";
import { handleFacebookCallback } from "@/src/server/social-connect";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleFacebookCallback(req, { store: deps.store, config: deps.config, secretKey: deps.destinationSecretKey, fetch: deps.fetch, now: () => new Date(), sessionUser: getSessionUser });
}
