// Meta's Deauthorize Callback URL (Facebook Login and Instagram Login): verifies signed_request, removes that user's connections.
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleMetaDeauthorize } from "@/src/server/meta-deletion";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleMetaDeauthorize(req, { store: deps.store, config: deps.config, now: () => new Date() });
}
