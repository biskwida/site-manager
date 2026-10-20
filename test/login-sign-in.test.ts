// test/login-sign-in.test.ts — what the /login form hands to Supabase Auth (browser client mocked): redirect URLs built by callbackUrl.
import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOtp = vi.fn(async (args: unknown) => (void args, { error: null as { message: string } | null }));
const signInWithOAuth = vi.fn(async (args: unknown) => (void args, { error: null as { message: string } | null }));
const createBrowserClient = vi.fn((url: string, key: string) => (void [url, key], { auth: { signInWithOtp, signInWithOAuth } }));
vi.mock("@supabase/ssr", () => ({ createBrowserClient: (url: string, key: string) => createBrowserClient(url, key) }));

import { sendEmailLink, startGoogle } from "@/app/login/sign-in";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
});

describe("sendEmailLink", () => {
  it("calls signInWithOtp with the trimmed email and emailRedirectTo = callbackUrl(origin, next)", async () => {
    expect(await sendEmailLink({ email: "  o@example.com ", origin: "https://getclaudia.app", next: "/admin/x?key=1" })).toEqual({ ok: true });
    expect(createBrowserClient).toHaveBeenCalledWith("https://x.supabase.co", "anon");
    expect(signInWithOtp).toHaveBeenCalledWith({ email: "o@example.com", options: { emailRedirectTo: "https://getclaudia.app/auth/callback?next=%2Fadmin%2Fx%3Fkey%3D1" } });
  });

  it("sanitises an off-site next in the redirect", async () => {
    await sendEmailLink({ email: "o@example.com", origin: "https://getclaudia.app", next: "//evil.example" });
    expect(signInWithOtp).toHaveBeenCalledWith({ email: "o@example.com", options: { emailRedirectTo: "https://getclaudia.app/auth/callback?next=%2Fdashboard" } });
  });

  it("reports a Supabase error, and a missing env, as not ok", async () => {
    signInWithOtp.mockResolvedValueOnce({ error: { message: "rate limited" } });
    expect(await sendEmailLink({ email: "o@example.com", origin: "https://getclaudia.app", next: "/dashboard" })).toEqual({ ok: false });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(await sendEmailLink({ email: "o@example.com", origin: "https://getclaudia.app", next: "/dashboard" })).toEqual({ ok: false });
  });
});

describe("startGoogle", () => {
  it("calls signInWithOAuth for google with redirectTo = callbackUrl(origin, next)", async () => {
    expect(await startGoogle({ origin: "https://getclaudia.app", next: "/new" })).toEqual({ ok: true });
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: "https://getclaudia.app/auth/callback?next=%2Fnew" } });
  });

  it("reports an error as not ok", async () => {
    signInWithOAuth.mockResolvedValueOnce({ error: { message: "x" } });
    expect(await startGoogle({ origin: "https://getclaudia.app", next: "/dashboard" })).toEqual({ ok: false });
  });
});
