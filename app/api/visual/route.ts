// app/api/visual/route.ts
// The picture service (photo → Instagram post/story). The only function that bundles the background-removal model.
import { getServerDeps } from "@/src/server/deps";
import { handleVisualRequest } from "@/src/server/visual";
import { cutout } from "@/src/visual/cutout";
import { geminiGenerate } from "@/src/visual/gemini";
import { renderJpeg } from "@/src/visual/render";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** The route's whole budget is 60 s; a restyle must be answered by 50 s after the request arrives (src/visual/restyle.ts). */
const RESTYLE_DEADLINE_MS = 50_000;

export async function POST(req: Request) {
  const deadline = Date.now() + RESTYLE_DEADLINE_MS;
  const deps = await getServerDeps(() => undefined);
  const read = async (url: string) => {
    try {
      const res = await deps.fetch(url, { signal: AbortSignal.timeout(15_000) });
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    } catch {
      return null;
    }
  };
  const { config } = deps;
  const restyle = config.geminiApiKey
    ? {
        store: deps.store,
        read,
        generate: geminiGenerate({ apiKey: config.geminiApiKey, model: config.restyleModel, fetch: deps.fetch }),
        limits: { monthly: config.restyleMonthlyLimit, trial: config.restyleTrialLimit },
      }
    : undefined;
  return handleVisualRequest(req, { secret: config.tickSecret, visual: { store: deps.store, read, cutout, render: renderJpeg }, restyle, deadline });
}
