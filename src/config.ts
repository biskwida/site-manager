// src/config.ts
// Server-only: never import from app/ client components or src/i18n.
export type Effort = "low" | "medium" | "high";

export interface Config {
  anthropicApiKey: string;
  agentModel: string;
  agentEffort: Effort;
  /** Small model for comment reply drafts (COMMENT_DRAFT_MODEL); one short call per comment. */
  commentDraftModel: string;
  telegramToken: string;
  telegramWebhookSecret: string;
  /** Any OpenAI-compatible transcription endpoint; Groq free tier by default. */
  sttApiKey: string | null;
  sttBaseUrl: string;
  sttModel: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceKey: string;
  publicBaseUrl: string;
  tickSecret: string;
  demoVenueSlug: string;
  /** Vercel token scoped to the team that hosts the venue sites; null disables real deploys (FakeDeployer). */
  vercelToken: string | null;
  vercelTeamId: string | null;
  /** Salt for hashed IPs in rate-limit keys. */
  rateSalt: string;
  maxSitesPerDay: number;
  /** For https://t.me/<bot>?start=<code> links on the wizard's done page. */
  telegramBotUsername: string | null;
  /** Meta app secret (App settings → Basic); verifies webhook signatures. Required with any Meta token. */
  metaAppSecret: string | null;
  /** Random string pasted into the app's Webhooks "Verify token" field. */
  metaVerifyToken: string | null;
  /** Page access token; enables Messenger and Instagram. */
  metaPageToken: string | null;
  /** WhatsApp Cloud API token; enables WhatsApp. */
  whatsappToken: string | null;
  /** WhatsApp phone number id shown in API Setup; required with whatsappToken. */
  whatsappPhoneNumberId: string | null;
  /** Page username for the m.me/<handle> invite link. */
  messengerPageHandle: string | null;
  /** Instagram username (no @) for the ig.me/m/<user> invite link. */
  instagramUsername: string | null;
  /** WhatsApp number, digits only with country code, for the wa.me/<digits> invite link. */
  whatsappNumber: string | null;
  /** 32-byte key for destination secrets (WordPress plugin tokens); null = destinations cannot be connected (memory mode falls back to a dev key). */
  destinationSecretKey: string | null;
  /** Meta app (Instagram API with Instagram Login) for the wizard's photo import; the feature is off unless both are set. */
  instagramAppId: string | null;
  instagramAppSecret: string | null;
  /**
   * CHANNELS_ENABLED (default false): the wizard and dashboard offer Messenger, Instagram and WhatsApp owner links only when
   * true AND that channel's token is configured (META_PAGE_TOKEN / WHATSAPP_TOKEN), so a link never points at an app this
   * deployment does not answer. Turn it on once the Meta webhooks point at this deployment (docs/CHANNELS.md). Telegram is unaffected.
   */
  channelsEnabled: boolean;
  /** Meta app id (App settings → Basic), public; with META_APP_SECRET it enables "Connect Facebook" for posting to the venue's Page. */
  metaAppId: string | null;
  /** Facebook Login for Business configuration id; when set the login sends config_id instead of a scope list. */
  metaLoginConfigId: string | null;
}

type Env = Record<string, string | undefined>;

const HANDLE = /^[A-Za-z0-9_.]{1,64}$/;
/**
 * A Page or Instagram handle from MESSENGER_PAGE_HANDLE / INSTAGRAM_USERNAME: a leading "@" is dropped and a pasted profile
 * link on one of `hosts` (with or without https://, trailing slash or query) is reduced to its single path segment. Anything
 * else is null, never an error: the app still starts and that app's link is simply not offered.
 */
export function parseHandle(raw: string | null, hosts: readonly string[]): string | null {
  if (!raw) return null;
  let v = raw.trim();
  if (v.includes("/") || v.includes(":")) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(url.protocol) || !hosts.includes(url.hostname.toLowerCase())) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 1) return null;
    v = parts[0];
  }
  v = v.replace(/^@/, "");
  return HANDLE.test(v) ? v : null;
}

/** `lenient` (offline memory-store mode) returns "" for missing secrets instead of throwing. */
export function loadConfig(env: Env = process.env, opts: { lenient?: boolean } = {}): Config {
  const need = (key: string): string => {
    const v = env[key]?.trim();
    if (!v) {
      if (opts.lenient) return "";
      throw new Error(`Missing ${key} (set it in .env.local or the Vercel project env; see .env.example)`);
    }
    return v;
  };
  const optional = (key: string): string | null => env[key]?.trim() || null;
  const effort = optional("AGENT_EFFORT") ?? "medium";
  if (effort !== "low" && effort !== "medium" && effort !== "high") throw new Error("AGENT_EFFORT must be low, medium or high");
  const maxSites = Number(optional("MAX_SITES_PER_DAY") ?? 50);
  if (!Number.isInteger(maxSites) || maxSites < 1) throw new Error("MAX_SITES_PER_DAY must be a positive integer");
  const metaPageToken = optional("META_PAGE_TOKEN");
  const whatsappToken = optional("WHATSAPP_TOKEN");
  const metaAppSecret = optional("META_APP_SECRET");
  const metaVerifyToken = optional("META_VERIFY_TOKEN");
  if ((metaPageToken || whatsappToken) && (!metaAppSecret || !metaVerifyToken)) throw new Error("META_APP_SECRET and META_VERIFY_TOKEN are required when META_PAGE_TOKEN or WHATSAPP_TOKEN is set");
  const whatsappPhoneNumberId = optional("WHATSAPP_PHONE_NUMBER_ID");
  if (whatsappToken && !whatsappPhoneNumberId) throw new Error("WHATSAPP_PHONE_NUMBER_ID is required with WHATSAPP_TOKEN");
  return {
    anthropicApiKey: need("ANTHROPIC_API_KEY"),
    agentModel: optional("AGENT_MODEL") ?? "claude-opus-5-5",
    agentEffort: effort,
    commentDraftModel: optional("COMMENT_DRAFT_MODEL") ?? "claude-haiku-5-5",
    telegramToken: need("TELEGRAM_BOT_TOKEN"),
    telegramWebhookSecret: need("TELEGRAM_WEBHOOK_SECRET"),
    sttApiKey: optional("STT_API_KEY"),
    sttBaseUrl: (optional("STT_BASE_URL") ?? "https://api.groq.com/openai/v1").replace(/\/+$/, ""),
    sttModel: optional("STT_MODEL") ?? "whisper-large-v3",
    supabaseUrl: need("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: need("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    supabaseServiceKey: need("SUPABASE_SERVICE_ROLE_KEY"),
    publicBaseUrl: (need("PUBLIC_BASE_URL") || "http://localhost:3000").replace(/\/+$/, ""),
    tickSecret: need("TICK_SECRET"),
    demoVenueSlug: optional("DEMO_VENUE_SLUG") ?? "agala",
    vercelToken: optional("VERCEL_TOKEN"),
    vercelTeamId: optional("VERCEL_TEAM_ID"),
    rateSalt: optional("RATE_SALT") ?? "dev-salt",
    maxSitesPerDay: maxSites,
    telegramBotUsername: optional("TELEGRAM_BOT_USERNAME")?.replace(/^@/, "") ?? null,
    metaAppSecret,
    metaVerifyToken,
    metaPageToken,
    whatsappToken,
    whatsappPhoneNumberId,
    destinationSecretKey: optional("DESTINATION_SECRET_KEY"),
    instagramAppId: optional("INSTAGRAM_APP_ID"),
    instagramAppSecret: optional("INSTAGRAM_APP_SECRET"),
    messengerPageHandle: parseHandle(optional("MESSENGER_PAGE_HANDLE"), ["m.me"]),
    instagramUsername: parseHandle(optional("INSTAGRAM_USERNAME"), ["instagram.com", "www.instagram.com"]),
    whatsappNumber: optional("WHATSAPP_NUMBER")?.replace(/\D/g, "") || null,
    channelsEnabled: /^(1|true)$/i.test(optional("CHANNELS_ENABLED") ?? ""),
    metaAppId: optional("META_APP_ID"),
    metaLoginConfigId: optional("META_LOGIN_CONFIG_ID"),
  };
}
