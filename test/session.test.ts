// test/session.test.ts — getSessionUser(): the signed-in user or null, never throws.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const createServerClient = vi.fn((...args: unknown[]) => (void args, { auth: { getUser } }));
const cookieStore = { getAll: vi.fn(() => [{ name: "sb-x-auth-token", value: "v" }]), set: vi.fn() };
const cookies = vi.fn(async () => cookieStore);
vi.mock("@supabase/ssr", () => ({ createServerClient: (...a: unknown[]) => createServerClient(...a) }));
vi.mock("next/headers", () => ({ cookies: () => cookies() }));

import { getSessionUser } from "@/src/server/session";

const ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.stubEnv("SITE_MANAGER_STORE", "");
});

describe("getSessionUser", () => {
  it("returns id and email of the verified user", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "o@example.com", app_metadata: { secret: 1 } } }, error: null });
    expect(await getSessionUser()).toEqual({ id: "u1", email: "o@example.com" });
    expect(createServerClient).toHaveBeenCalledWith("https://x.supabase.co", "anon", expect.objectContaining({ cookies: expect.objectContaining({ getAll: expect.any(Function), setAll: expect.any(Function) }) }));
  });

  it("hands the request's cookies to the client and tolerates a read-only cookie store", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await getSessionUser();
    const opts = createServerClient.mock.calls[0][2] as { cookies: { getAll: () => unknown; setAll: (c: { name: string; value: string; options?: object }[]) => void } };
    expect(opts.cookies.getAll()).toEqual([{ name: "sb-x-auth-token", value: "v" }]);
    cookieStore.set.mockImplementation(() => {
      throw new Error("Cookies can only be modified in a Server Action or Route Handler");
    });
    expect(() => opts.cookies.setAll([{ name: "a", value: "b", options: {} }])).not.toThrow();
  });

  it("is null without a user", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await getSessionUser()).toBeNull();
  });

  it("is null when the session does not verify", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid JWT" } });
    expect(await getSessionUser()).toBeNull();
  });

  it("is null for a user without an email", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: undefined } }, error: null });
    expect(await getSessionUser()).toBeNull();
  });

  it("never throws: a failing client or cookie read gives null", async () => {
    getUser.mockRejectedValue(new Error("network"));
    expect(await getSessionUser()).toBeNull();
    cookies.mockRejectedValueOnce(new Error("outside a request"));
    expect(await getSessionUser()).toBeNull();
  });

  it("is null, without touching Supabase, when the public env is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(await getSessionUser()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ENV.NEXT_PUBLIC_SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(await getSessionUser()).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("is null in the memory (offline) mode even when the env is set", async () => {
    vi.stubEnv("SITE_MANAGER_STORE", "memory");
    expect(await getSessionUser()).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
  });
});
