// src/server/deps.ts
// Server-only: holds the service-role Supabase key and the bot token. Never import from client components.
import Anthropic from "@anthropic-ai/sdk";
import type { Bot } from "grammy";
import { runTurn } from "../agent/run";
import { ConsoleMessenger } from "../channels/console";
import { downloadUrl, downloadWhatsAppMedia, type MediaFetch } from "../channels/meta/graph";
import { MetaMessenger } from "../channels/meta/send";
import { makeRef, type Channel } from "../channels/ref";
import { ChannelRouter } from "../channels/router";
import { WhatsAppMessenger } from "../channels/whatsapp/send";
import { createBot, type BotDeps, type RunRequest } from "../bot/bot";
import { makeLangClassifier } from "../bot/lang-classify";
import { downloadTelegramFile } from "../bot/media";
import { TelegramMessenger, type Messenger } from "../bot/messenger";
import { makeTranslator, withTranslation } from "../bot/translate";
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
import { draftReply, type DraftFn } from "../social/comments-draft";
import { makeLiveComments } from "../social/comments-poll";
import { connectWordPress, wordPressClientFor } from "../destinations/connect";
import { instagramAccess } from "../agent/boost-tools";
import { socialConnections } from "../agent/social-tools";
import { httpVisualClient } from "../visual/client";
import { billingConfigOf } from "../billing/entitlements";
import type { TrialBilling } from "../billing/reminders";
import { sendEmail } from "./email";
import { memoryOwnerEmails, supabaseOwnerEmails } from "./owner-emails";

export interface ServerDeps {
  config: Config;
  store: Store;
  /**
   * Every text to an owner goes through this: withTranslation (src/bot/translate.ts) in front of the ChannelRouter, which dispatches by
   * chat_ref prefix to the per-channel adapters. The webhook turns, the approvals, the dashboard and the tick all send through it.
   */
  messenger: Messenger;
  bot: Bot;
  /** Shared with createBot; the Meta webhook route reuses it for inbound handling. */
  botDeps: BotDeps;
  /** WhatsApp media id → bytes (two-step Graph download with the bearer token). */
  waDownload: MediaFetch;
  /** Plain URL → bytes (Messenger/Instagram attachment URLs). */
  fetchUrl: MediaFetch;
  /** Per-venue tick, then the agent turn. Logs and swallows errors. */
  handleRun: (r: RunRequest) => Promise<void>;
  isMemory: boolean;
  /** Key for destination secrets; null = integrations are off (production without DESTINATION_SECRET_KEY). */
  destinationSecretKey: Buffer | null;
  /** Destination sync deps for the tick; null when integrations are off. */
  sync: SyncDeps | null;
  /** Comment reply drafting for the tick; null when integrations are off. */
  comments: { draft: DraftFn } | null;
  /** The free trial's end and reminders for the tick; null while BILLING_ENABLED is off. */
  billing: TrialBilling | null;
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
      const ref = env.DEMO_OWNER_CHAT_REF?.trim() || (Number.isInteger(chat) && chat > 0 ? makeRef("tg", chat) : null);
      if (ref) await mem.upsertMember({ venue_id: venue.id, chat_ref: ref, role: "owner", lang: "bg" });
      log(`[memory store] demo venue "${venue.slug}" seeded; admin link: ${config.publicBaseUrl}/admin/${venue.slug}?key=${await mem.getAdminToken(venue.id)}`);
      store = mem;
    } else {
      store = new SupabaseStore(config.supabaseUrl, config.supabaseServiceKey);
    }
  }
  const s = store;
  // Billing (BILLING_ENABLED on): the store reads these settings for the trial/plan change limit, and the tick ends trials and sends reminders.
  // Off, the store has no billing settings and the tick no billing deps: everything behaves as before billing existed.
  const billing: TrialBilling | null = config.billingEnabled
    ? {
        config: billingConfigOf(config),
        ownerEmails: isMemory ? memoryOwnerEmails : supabaseOwnerEmails(config.supabaseUrl, config.supabaseServiceKey),
        sendEmail: (msg) => sendEmail(msg, { apiKey: config.resendApiKey, from: config.emailFrom }, o.fetch),
        emailEnabled: Boolean(config.resendApiKey),
      }
    : null;
  if (billing) s.billingConfig = billing.config;
  const destinationSecretKey = resolveSecretKey(config.destinationSecretKey, isMemory, log);
  const sync: SyncDeps | null = destinationSecretKey ? { store: s, secretKey: destinationSecretKey, log } : null;
  // Every apply (bot button, dashboard, tick, agent) goes through store2 so wp_* rows reach the site right after the apply.
  const store2: Store = sync ? withDestinationSync(s, sync) : s;
  // One classifier names the language of the owner's longer Latin-script words (botDeps) and of a customer's comment (the reply
  // draft). Without an API key there is none: the owner's words go by the English word list, a Latin comment is answered in English.
  const classifyLang = anthropic ? makeLangClassifier(anthropic, config.langClassifyModel) : null;
  // Without an API key draftReply answers with the neutral fallback line, so the owner still gets a proposal to edit.
  const comments = sync ? { draft: (ctx: Parameters<DraftFn>[0]) => draftReply(anthropic, { model: config.commentDraftModel, classify: classifyLang }, ctx) } : null;
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
    classifyLang,
    download: (filePath) => downloadTelegramFile(config.telegramToken, filePath),
    connect: sync ? (venueId, siteUrl, code) => connectWordPress({ store: s, secretKey: destinationSecretKey, allowLocal: isMemory }, venueId, siteUrl, code) : undefined,
    // Without a deployer the hosted /<slug> is the site: nothing to publish, so no hook (and no "publishing" line).
    onOwnerJoined: deployer ? startDeploy : undefined,
  };
  const bot = createBot(botDeps);
  const adapters: Partial<Record<Channel, Messenger>> = { tg: new TelegramMessenger(bot.api) };
  if (config.metaPageToken) adapters.fb = adapters.ig = new MetaMessenger({ pageToken: config.metaPageToken });
  if (config.whatsappToken && config.whatsappPhoneNumberId) adapters.wa = new WhatsAppMessenger({ token: config.whatsappToken, phoneNumberId: config.whatsappPhoneNumberId });
  if (isMemory) for (const ch of ["fb", "ig", "wa"] as const) adapters[ch] ??= new ConsoleMessenger(log);
  // Members chatting in a language other than Bulgarian or English get Claudia's fixed texts translated (TRANSLATE_MODEL, cached);
  // every member gets them without keep markers. Without an API key those languages get the English texts.
  const router = new ChannelRouter({ store: store2, now: () => new Date(), adapters });
  const messenger = withTranslation(router, { store: store2, translate: anthropic ? makeTranslator(anthropic, config.translateModel, store2) : null });
  botDeps.messenger = messenger;
  const waDownload: MediaFetch = (mediaId) => downloadWhatsAppMedia(config.whatsappToken ?? "", mediaId);
  const fetchUrl: MediaFetch = (url) => downloadUrl(url);

  // The picture service runs as its own function (/api/visual) on this same deployment, reached with the tick secret.
  const visual = config.tickSecret ? httpVisualClient({ baseUrl: config.publicBaseUrl, secret: config.tickSecret, fetch: o.fetch, restyle: config.geminiApiKey !== null }) : null;

  async function handleRun(r: RunRequest): Promise<void> {
    try {
      await runTick({ store: store2, messenger, now: new Date(), venueId: r.venueId, deployer, sync, comments, billing });
    } catch (e) {
      console.error("[tick] per-webhook tick failed:", e instanceof Error ? e.message : e);
    }
    const wp = sync ? await wordPressClientFor({ store: s, secretKey: destinationSecretKey }, r.venueId).catch(() => null) : null;
    const social = sync ? await socialConnections(s, r.venueId).catch(() => null) : null;
    try {
      await runTurn(
        { store: store2, venueId: r.venueId, chatRef: r.chatRef, member: r.member, messenger, now: () => new Date(), baseUrl: config.publicBaseUrl, wordpress: wp?.client ?? null, social, visual, liveComments: sync ? makeLiveComments(sync, () => new Date()) : null, instagramInsights: sync ? (venueId) => instagramAccess(sync, venueId) : null },
        { text: r.text, source: r.source, image: r.image, mediaId: r.mediaId, replyTo: r.replyTo },
        { model: config.agentModel, effort: config.agentEffort, apiKey: config.anthropicApiKey || undefined },
        o.client,
      );
    } catch (e) {
      console.error("[agent] run failed:", e instanceof Error ? e.message : e);
    }
  }

  const outbound: typeof fetch = o.fetch ?? ((input, init) => fetch(input, init));
  return { config, store: store2, messenger, bot, botDeps, waDownload, fetchUrl, handleRun, isMemory, deployer, startDeploy, watchDeploy, anthropic, destinationSecretKey, sync, comments, billing, fetch: outbound };
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
