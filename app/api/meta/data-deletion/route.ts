// Meta's Data Deletion Request URL: verifies signed_request, removes that user's connections, answers { url, confirmation_code }.
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleMetaDataDeletion } from "@/src/server/meta-deletion";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleMetaDataDeletion(req, { store: deps.store, config: deps.config, now: () => new Date() });
}
