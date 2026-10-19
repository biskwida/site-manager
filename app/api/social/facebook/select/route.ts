// The Page chooser's form target (several Pages): re-reads the Pages with the user token from the signed state and stores the pick.
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { getSessionUser } from "@/src/server/session";
import { handleFacebookSelect } from "@/src/server/social-connect";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleFacebookSelect(req, { store: deps.store, config: deps.config, secretKey: deps.destinationSecretKey, fetch: deps.fetch, now: () => new Date(), sessionUser: getSessionUser });
}
