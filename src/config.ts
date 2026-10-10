// src/config.ts
// Server-only: never import from app/ client components or src/i18n.
export type Effort = "low" | "medium" | "high";

export interface Config {
  anthropicApiKey: string;
  agentModel: string;
  agentEffort: Effort;
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
}

type Env = Record<string, string | undefined>;

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
  return {
    anthropicApiKey: need("ANTHROPIC_API_KEY"),
    agentModel: optional("AGENT_MODEL") ?? "claude-opus-5-5",
    agentEffort: effort,
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
  };
}
