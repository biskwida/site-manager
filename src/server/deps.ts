// src/server/deps.ts
// Server-only: holds the service-role Supabase key and the bot token. Never import from client components.
import type Anthropic from "@anthropic-ai/sdk";
import type { Bot } from "grammy";
import { runTurn } from "../agent/run";
import { createBot, type BotDeps, type RunRequest } from "../bot/bot";
import { downloadTelegramFile } from "../bot/media";
import { TelegramMessenger, type Messenger } from "../bot/messenger";
import { makeTranscriber, type Transcriber } from "../bot/voice";
import { loadConfig, type Config } from "../config";
import { seedDemo } from "../seed/demo";
import { InMemoryStore } from "../store/memory";
import { SupabaseStore } from "../store/supabase";
import type { Store } from "../store/types";
import { runTick } from "../tick";

export interface ServerDeps {
  config: Config;
  store: Store;
  messenger: Messenger;
  bot: Bot;
  /** Per-venue tick, then the agent turn. Logs and swallows errors. */
  handleRun: (r: RunRequest) => Promise<void>;
  isMemory: boolean;
}

export interface DepsOptions {
  /** Runs a background job after the response (after() on Vercel; a floating promise elsewhere). */
  defer: (fn: () => Promise<void>) => void;
  env?: Record<string, string | undefined>;
  store?: Store;
  transcribe?: Transcriber | null;
  client?: Anthropic;
  log?: (line: string) => void;
}

export async function makeServerDeps(o: DepsOptions): Promise<ServerDeps> {
  const env = o.env ?? process.env;
  const isMemory = env.SITE_MANAGER_STORE === "memory";
  const config = loadConfig(env, { lenient: isMemory });
  const log = o.log ?? ((s: string) => console.log(s));

  let store = o.store;
  if (!store) {
    if (isMemory) {
      const mem = new InMemoryStore();
      const { venue } = await seedDemo(mem, config.demoVenueSlug);
      const chat = Number(env.DEMO_OWNER_CHAT_ID);
      if (Number.isInteger(chat) && chat > 0) await mem.upsertMember({ venue_id: venue.id, tg_chat_id: chat, role: "owner", lang: "bg" });
      log(`[memory store] demo venue "${venue.slug}" seeded; admin link: ${config.publicBaseUrl}/admin/${venue.slug}?key=${await mem.getAdminToken(venue.id)}`);
      store = mem;
    } else {
      store = new SupabaseStore(config.supabaseUrl, config.supabaseServiceKey);
    }
  }
  const s = store;
  const transcribe =
    o.transcribe !== undefined ? o.transcribe : config.sttApiKey ? makeTranscriber({ apiKey: config.sttApiKey, baseUrl: config.sttBaseUrl, model: config.sttModel }) : null;

  // createBot's handlers read `d.messenger` at call time, so the messenger (which needs bot.api) is set on this same object below.
  const botDeps: BotDeps = {
    token: config.telegramToken || "memory-mode-no-token",
    store: s,
    messenger: undefined as unknown as Messenger,
    baseUrl: config.publicBaseUrl,
    now: () => new Date(),
    startRun: (r) => o.defer(() => handleRun(r)),
    transcribe,
    download: (filePath) => downloadTelegramFile(config.telegramToken, filePath),
  };
  const bot = createBot(botDeps);
  const messenger = new TelegramMessenger(bot.api);
  botDeps.messenger = messenger;

  async function handleRun(r: RunRequest): Promise<void> {
    try {
      await runTick({ store: s, messenger, now: new Date(), venueId: r.venueId });
    } catch (e) {
      console.error("[tick] per-webhook tick failed:", e instanceof Error ? e.message : e);
    }
    try {
      await runTurn(
        { store: s, venueId: r.venueId, chatId: r.chatId, member: r.member, messenger, now: () => new Date(), baseUrl: config.publicBaseUrl },
        { text: r.text, source: r.source, image: r.image, mediaId: r.mediaId },
        { model: config.agentModel, effort: config.agentEffort, apiKey: config.anthropicApiKey || undefined },
        o.client,
      );
    } catch (e) {
      console.error("[agent] run failed:", e instanceof Error ? e.message : e);
    }
  }

  return { config, store: s, messenger, bot, handleRun, isMemory };
}

// On globalThis, not a module variable: `next dev` (HMR, separate route bundles) then shares one in-memory store between pages and API routes.
const g = globalThis as { __siteManagerDeps?: Promise<ServerDeps> | null };
/** One set of deps per server process (Vercel function instance or dev server). */
export function getServerDeps(defer: DepsOptions["defer"]): Promise<ServerDeps> {
  g.__siteManagerDeps ??= makeServerDeps({ defer }).catch((e) => {
    g.__siteManagerDeps = null; // let the next request retry (e.g. after env vars are fixed)
    throw e;
  });
  return g.__siteManagerDeps;
}
