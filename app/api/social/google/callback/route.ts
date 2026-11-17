// Google's OAuth redirect for the Business Profile: checks state + nonce cookie, stores the location (or shows the chooser), back to the dashboard.
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleGoogleCallback } from "@/src/server/google-connect";
import { getSessionUser } from "@/src/server/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleGoogleCallback(req, { store: deps.store, config: deps.config, secretKey: deps.destinationSecretKey, fetch: deps.fetch, now: () => new Date(), sessionUser: getSessionUser });
}
