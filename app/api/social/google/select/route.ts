// The location chooser's form target (several locations): lists the locations again with the refresh token from the signed state and stores the pick.
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleGoogleSelect } from "@/src/server/google-connect";
import { getSessionUser } from "@/src/server/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleGoogleSelect(req, { store: deps.store, config: deps.config, secretKey: deps.destinationSecretKey, fetch: deps.fetch, now: () => new Date(), sessionUser: getSessionUser });
}
