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
import { FakeDeployer } from "../deploy/fake";
import { buildFiles } from "../deploy/manifest";
import { startDeploy as runStartDeploy } from "../deploy/run";
import type { Deployer } from "../deploy/types";
import { VercelDeployer } from "../deploy/vercel";
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
  /** VercelDeployer when VERCEL_TOKEN is set and the store is Supabase; FakeDeployer otherwise. */
  deployer: Deployer;
  /** Deferred: creates the venue's site (no-op when it is not live or already has one). */
  startDeploy: (venueId: string) => void;
}

export interface DepsOptions {
  /** Runs a background job after the response (after() on Vercel; a floating promise elsewhere). */
  defer: (fn: () => Promise<void>) => void;
  env?: Record<string, string | undefined>;
  store?: Store;
  transcribe?: Transcriber | null;
  client?: Anthropic;
  log?: (line: string) => void;
  deployer?: Deployer;
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
  const deployer: Deployer = o.deployer ?? (config.vercelToken && !isMemory ? new VercelDeployer({ token: config.vercelToken, teamId: config.vercelTeamId, files: (id) => buildFiles(id), log }) : new FakeDeployer());
  if (deployer.provider === "fake") log(`[deploy] fake deployer (${isMemory ? "memory store" : "VERCEL_TOKEN not set"}): sites get https://<slug>.example.test`);
  const feedUrlFor = (slug: string) => `${config.publicBaseUrl}/api/site/${encodeURIComponent(slug)}`;
  const startDeploy = (venueId: string) => o.defer(() => runStartDeploy({ store: s, deployer, feedUrlFor, now: () => new Date(), log }, venueId));

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
    onOwnerJoined: startDeploy,
  };
  const bot = createBot(botDeps);
  const messenger = new TelegramMessenger(bot.api);
  botDeps.messenger = messenger;

  async function handleRun(r: RunRequest): Promise<void> {
    try {
      await runTick({ store: s, messenger, now: new Date(), venueId: r.venueId, deployer });
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

  return { config, store: s, messenger, bot, handleRun, isMemory, deployer, startDeploy };
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
