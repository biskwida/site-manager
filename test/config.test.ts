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
    expect(c).toMatchObject({ agentModel: "claude-haiku-5-5", agentEffort: "medium", sttApiKey: null, sttBaseUrl: "https://api.groq.com/openai/v1", sttModel: "whisper-large-v3", demoVenueSlug: "agala", publicBaseUrl: "https://site.example", commentDraftModel: "claude-haiku-5-5" });
  });
  it("reads COMMENT_DRAFT_MODEL", () => {
    expect(loadConfig({ ...full, COMMENT_DRAFT_MODEL: "claude-sonnet-5-5" }).commentDraftModel).toBe("claude-sonnet-5-5");
  });
  it("reads LANG_CLASSIFY_MODEL and TRANSLATE_MODEL, both claude-haiku-5-5 by default", () => {
    expect(loadConfig(full)).toMatchObject({ langClassifyModel: "claude-haiku-5-5", translateModel: "claude-haiku-5-5" });
    expect(loadConfig({ ...full, LANG_CLASSIFY_MODEL: "claude-haiku-test", TRANSLATE_MODEL: "claude-sonnet-5-5" })).toMatchObject({ langClassifyModel: "claude-haiku-test", translateModel: "claude-sonnet-5-5" });
  });
  it("names the missing key", () => {
    expect(() => loadConfig({ ...full, TELEGRAM_BOT_TOKEN: "" })).toThrow(/Missing TELEGRAM_BOT_TOKEN/);
  });
  it("rejects a bad effort", () => {
    expect(() => loadConfig({ ...full, AGENT_EFFORT: "max" })).toThrow(/AGENT_EFFORT/);
  });
  it("refuses a PUBLIC_BASE_URL without http:// or https://", () => {
    for (const bad of ["site.example", "//site.example", "ftp://site.example", "localhost:3000"]) expect(() => loadConfig({ ...full, PUBLIC_BASE_URL: bad })).toThrow(/PUBLIC_BASE_URL must start with http:\/\/ or https:\/\//);
    expect(loadConfig({ ...full, PUBLIC_BASE_URL: "http://localhost:3000/" }).publicBaseUrl).toBe("http://localhost:3000");
    expect(loadConfig({}, { lenient: true }).publicBaseUrl).toBe("http://localhost:3000");
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
  it("reads the Meta channel keys and insists on the shared secrets", () => {
    expect(loadConfig(full)).toMatchObject({ metaAppSecret: null, metaVerifyToken: null, metaPageToken: null, whatsappToken: null, whatsappPhoneNumberId: null, messengerPageHandle: null, instagramUsername: null, whatsappNumber: null });
    const meta = { ...full, META_APP_SECRET: "sec", META_VERIFY_TOKEN: "ver", META_PAGE_TOKEN: "pt", WHATSAPP_TOKEN: "wt", WHATSAPP_PHONE_NUMBER_ID: "123", MESSENGER_PAGE_HANDLE: "sitemanagerbg", INSTAGRAM_USERNAME: "@sitemanager.bg", WHATSAPP_NUMBER: "+359 888 123 456" };
    expect(loadConfig(meta)).toMatchObject({ metaPageToken: "pt", whatsappPhoneNumberId: "123", instagramUsername: "sitemanager.bg", whatsappNumber: "359888123456" });
    expect(() => loadConfig({ ...full, META_PAGE_TOKEN: "pt" })).toThrow(/META_APP_SECRET and META_VERIFY_TOKEN/);
    expect(() => loadConfig({ ...full, META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", WHATSAPP_TOKEN: "wt" })).toThrow(/WHATSAPP_PHONE_NUMBER_ID/);
  });
  it("reads DESTINATION_SECRET_KEY as optional", () => {
    expect(loadConfig(full).destinationSecretKey).toBeNull();
    expect(loadConfig({ ...full, DESTINATION_SECRET_KEY: "ab".repeat(32) }).destinationSecretKey).toBe("ab".repeat(32));
  });

  it("reads the optional Instagram app id and secret (both or nothing)", () => {
    expect(loadConfig(full)).toMatchObject({ instagramAppId: null, instagramAppSecret: null });
    expect(loadConfig({ ...full, INSTAGRAM_APP_ID: " 123 ", INSTAGRAM_APP_SECRET: "sec" })).toMatchObject({ instagramAppId: "123", instagramAppSecret: "sec" });
    expect(loadConfig({ ...full, INSTAGRAM_APP_ID: "123" })).toMatchObject({ instagramAppId: "123", instagramAppSecret: null });
  });
});
