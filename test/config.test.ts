import { describe, expect, it } from "vitest";
import { loadConfig } from "@/src/config";

const full = {
  ANTHROPIC_API_KEY: "a",
  TELEGRAM_BOT_TOKEN: "t",
  TELEGRAM_WEBHOOK_SECRET: "s",
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  TICK_SECRET: "tick",
  PUBLIC_BASE_URL: "https://site.example/",
};

describe("loadConfig", () => {
  it("reads every key with defaults", () => {
    const c = loadConfig(full);
    expect(c).toMatchObject({ agentModel: "claude-opus-5-5", agentEffort: "medium", sttApiKey: null, sttBaseUrl: "https://api.groq.com/openai/v1", sttModel: "whisper-large-v3", demoVenueSlug: "agala", publicBaseUrl: "https://site.example" });
  });
  it("names the missing key", () => {
    expect(() => loadConfig({ ...full, TELEGRAM_BOT_TOKEN: "" })).toThrow(/Missing TELEGRAM_BOT_TOKEN/);
  });
  it("rejects a bad effort", () => {
    expect(() => loadConfig({ ...full, AGENT_EFFORT: "max" })).toThrow(/AGENT_EFFORT/);
  });
  it("fills missing keys with empty strings when lenient", () => {
    const c = loadConfig({}, { lenient: true });
    expect(c.telegramToken).toBe("");
    expect(c.publicBaseUrl).toBe("http://localhost:3000");
  });
});
