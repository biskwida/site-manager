// src/server/deps.ts
// Server-only: holds the service-role Supabase key and the bot token. Never import from client components.
import Anthropic from "@anthropic-ai/sdk";
import type { Bot } from "grammy";
import { runTurn } from "../agent/run";
import { createBot, type BotDeps, type RunRequest } from "../bot/bot";
import { downloadTelegramFile } from "../bot/media";
import { TelegramMessenger, type Messenger } from "../bot/messenger";
import { makeTranscriber, type Transcriber } from "../bot/voice";
import { loadConfig, type Config } from "../config";
import { FakeDeployer } from "../deploy/fake";
import { buildFiles } from "../deploy/manifest";
import { startDeploy as runStartDeploy, watchDeploy as runWatchDeploy } from "../deploy/run";
import type { Deployer } from "../deploy/types";
import { VercelDeployer } from "../deploy/vercel";
import { seedDemo } from "../seed/demo";
import { InMemoryStore } from "../store/memory";
import { SupabaseStore } from "../store/supabase";
import type { Store } from "../store/types";
import { runTick } from "../tick";
import { resolveSecretKey } from "../destinations/secrets";
import { withDestinationSync } from "../destinations/store-hook";
import type { SyncDeps } from "../destinations/sync";
import { connectWordPress, wordPressClientFor } from "../destinations/connect";

export interface ServerDeps {
  config: Config;
  store: Store;
  messenger: Messenger;
  bot: Bot;
  /** Per-venue tick, then the agent turn. Logs and swallows errors. */
  handleRun: (r: RunRequest) => Promise<void>;
  isMemory: boolean;
  /** Key for destination secrets; null = integrations are off (production without DESTINATION_SECRET_KEY). */
  destinationSecretKey: Buffer | null;
  /** Destination sync deps for the tick; null when integrations are off. */
  sync: SyncDeps | null;
  /**
   * FakeDeployer in memory mode; VercelDeployer when VERCEL_TOKEN is set; null otherwise (production without a token):
   * no venue projects are created and every site is served from the hosted /<slug>.
   */
  deployer: Deployer | null;
  /** Deferred: creates the venue's site (no-op when it is not live or already has one, or without a deployer), then watches it. */
  startDeploy: (venueId: string) => void;
  /** Deferred: polls the venue's in-flight deployment every 10 s for up to 240 s (after a template switch); no-op without a deployer. */
  watchDeploy: (venueId: string) => void;
  /** Shared Anthropic client for the wizard AI routes; null without ANTHROPIC_API_KEY (offline mode). Tests inject `client`. */
  anthropic: Anthropic | null;
  /** Outbound HTTP for the wizard's Instagram import (Instagram API and CDN); tests inject a fake. */
  fetch: typeof fetch;
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
  /** watchDeploy's wait between polls; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  fetch?: typeof fetch;
}

export async function makeServerDeps(o: DepsOptions): Promise<ServerDeps> {
  const env = o.env ?? process.env;
  const isMemory = env.SITE_MANAGER_STORE === "memory";
  const config = loadConfig(env, { lenient: isMemory });
  const log = o.log ?? ((s: string) => console.log(s));
  const anthropic = o.client ?? (config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null);

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
  const destinationSecretKey = resolveSecretKey(config.destinationSecretKey, isMemory, log);
  const sync: SyncDeps | null = destinationSecretKey ? { store: s, secretKey: destinationSecretKey, log } : null;
  // Every apply (bot button, dashboard, tick, agent) goes through store2 so wp_* rows reach the site right after the apply.
  const store2: Store = sync ? withDestinationSync(s, sync) : s;
  const transcribe =
    o.transcribe !== undefined ? o.transcribe : config.sttApiKey ? makeTranscriber({ apiKey: config.sttApiKey, baseUrl: config.sttBaseUrl, model: config.sttModel }) : null;
  // The fake deployer is for offline mode only: in production it would hand owners https://<slug>.example.test.
  const deployer: Deployer | null =
    o.deployer ??
    (isMemory ? new FakeDeployer() : config.vercelToken ? new VercelDeployer({ token: config.vercelToken, teamId: config.vercelTeamId, files: (id) => buildFiles(id), log }) : null);
  if (deployer?.provider === "fake") log("[deploy] fake deployer (memory store): sites get https://<slug>.example.test");
  if (!deployer) log("[deploy] no VERCEL_TOKEN: no venue deployments; sites are served from the hosted /<slug>");
  const feedUrlFor = (slug: string) => `${config.publicBaseUrl}/api/site/${encodeURIComponent(slug)}`;
  // The messenger is created below (it needs bot.api); these closures read it when they run, after this function returned.
  const watch = (dep: Deployer, venueId: string) => runWatchDeploy({ store: s, deployer: dep, messenger, now: () => new Date(), sleep: o.sleep, log }, venueId);
  const startDeploy = (venueId: string) => {
    if (deployer)
      o.defer(async () => {
        await runStartDeploy({ store: s, deployer, feedUrlFor, now: () => new Date(), log }, venueId);
        await watch(deployer, venueId);
      });
  };
  const watchDeploy = (venueId: string) => {
    if (deployer) o.defer(() => watch(deployer, venueId));
  };

  // createBot's handlers read `d.messenger` at call time, so the messenger (which needs bot.api) is set on this same object below.
  const botDeps: BotDeps = {
    token: config.telegramToken || "memory-mode-no-token",
    store: store2,
    messenger: undefined as unknown as Messenger,
    baseUrl: config.publicBaseUrl,
    now: () => new Date(),
    startRun: (r) => o.defer(() => handleRun(r)),
    transcribe,
    download: (filePath) => downloadTelegramFile(config.telegramToken, filePath),
    connect: sync ? (venueId, siteUrl, code) => connectWordPress({ store: s, secretKey: destinationSecretKey, allowLocal: isMemory }, venueId, siteUrl, code) : undefined,
    // Without a deployer the hosted /<slug> is the site: nothing to publish, so no hook (and no "publishing" line).
    onOwnerJoined: deployer ? startDeploy : undefined,
  };
  const bot = createBot(botDeps);
  const messenger: Messenger = new TelegramMessenger(bot.api);
  botDeps.messenger = messenger;

  async function handleRun(r: RunRequest): Promise<void> {
    try {
      await runTick({ store: store2, messenger, now: new Date(), venueId: r.venueId, deployer, sync });
    } catch (e) {
      console.error("[tick] per-webhook tick failed:", e instanceof Error ? e.message : e);
    }
    const wp = sync ? await wordPressClientFor({ store: s, secretKey: destinationSecretKey }, r.venueId).catch(() => null) : null;
    try {
      await runTurn(
        { store: store2, venueId: r.venueId, chatId: r.chatId, member: r.member, messenger, now: () => new Date(), baseUrl: config.publicBaseUrl, wordpress: wp?.client ?? null },
        { text: r.text, source: r.source, image: r.image, mediaId: r.mediaId },
        { model: config.agentModel, effort: config.agentEffort, apiKey: config.anthropicApiKey || undefined },
        o.client,
      );
    } catch (e) {
      console.error("[agent] run failed:", e instanceof Error ? e.message : e);
    }
  }

  const outbound: typeof fetch = o.fetch ?? ((input, init) => fetch(input, init));
  return { config, store: store2, messenger, bot, handleRun, isMemory, deployer, startDeploy, watchDeploy, anthropic, destinationSecretKey, sync, fetch: outbound };
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
