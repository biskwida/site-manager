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
  it("reads the deploy and wizard keys with defaults", () => {
    expect(loadConfig(full)).toMatchObject({ vercelToken: null, vercelTeamId: null, rateSalt: "dev-salt", maxSitesPerDay: 50, telegramBotUsername: null });
    expect(loadConfig({ ...full, VERCEL_TOKEN: "v", VERCEL_TEAM_ID: "team_1", RATE_SALT: "s", MAX_SITES_PER_DAY: "7", TELEGRAM_BOT_USERNAME: "@site_manager_bot" })).toMatchObject({ vercelToken: "v", vercelTeamId: "team_1", rateSalt: "s", maxSitesPerDay: 7, telegramBotUsername: "site_manager_bot" });
    expect(() => loadConfig({ ...full, MAX_SITES_PER_DAY: "0" })).toThrow(/MAX_SITES_PER_DAY/);
  });
  it("reads DESTINATION_SECRET_KEY as optional", () => {
    expect(loadConfig(full).destinationSecretKey).toBeNull();
    expect(loadConfig({ ...full, DESTINATION_SECRET_KEY: "ab".repeat(32) }).destinationSecretKey).toBe("ab".repeat(32));
  });
});
