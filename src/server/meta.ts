// src/server/meta.ts
// One webhook for Messenger, Instagram and WhatsApp. GET = Meta's verification handshake; POST = events, verified with X-Hub-Signature-256,
// acknowledged at once and processed in the deferred callback (Meta retries anything slower than ~20 s).
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BotDeps, RunRequest } from "../bot/bot";
import { handleInbound } from "../bot/inbound";
import type { MediaFetch } from "../channels/meta/graph";
import { parseMetaWebhook } from "../channels/meta/parse";
import type { Config } from "../config";

export interface MetaServerDeps {
  config: Pick<Config, "metaAppSecret" | "metaVerifyToken">;
  botDeps: BotDeps;
  handleRun: (r: RunRequest) => Promise<void>;
  defer: (fn: () => Promise<void>) => void;
  waDownload: MediaFetch;
  fetchUrl: MediaFetch;
}

export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=") || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const DEDUPE_MAX = 500;
let seen = new Set<string>();
function isNew(id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > DEDUPE_MAX) seen = new Set([...seen].slice(seen.size - DEDUPE_MAX));
  return true;
}
export function resetDedupe(): void { seen = new Set(); }

export async function handleMetaRequest(req: Request, deps: MetaServerDeps): Promise<Response> {
  if (req.method === "GET") {
    const u = new URL(req.url);
    const token = deps.config.metaVerifyToken;
    if (u.searchParams.get("hub.mode") === "subscribe" && token && u.searchParams.get("hub.verify_token") === token) {
      return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
    }
    return new Response("forbidden", { status: 403 });
  }
  const raw = await req.text();
  if (!deps.config.metaAppSecret || !verifySignature(raw, req.headers.get("x-hub-signature-256"), deps.config.metaAppSecret)) return new Response("unauthorized", { status: 401 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response("bad request", { status: 400 }); }
  const messages = parseMetaWebhook(body, { waDownload: deps.waDownload, fetchUrl: deps.fetchUrl }).filter((m) => !m.eventId || isNew(m.eventId));
  if (messages.length) {
    deps.defer(async () => {
      // The agent turn is awaited inside this same deferred callback, so nothing is left floating when the function instance is frozen.
      const runs: Promise<void>[] = [];
      const d: BotDeps = { ...deps.botDeps, startRun: (r) => { runs.push(deps.handleRun(r)); } };
      for (const m of messages) {
        try { await handleInbound(d, m); } catch (e) { console.error("[meta] inbound failed:", e instanceof Error ? e.message : e); }
      }
      await Promise.all(runs);
    });
  }
  return new Response("EVENT_RECEIVED", { status: 200 });
}
