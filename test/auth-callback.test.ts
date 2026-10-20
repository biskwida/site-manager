// test/auth-callback.test.ts — GET /auth/callback: exchange the code, claim account invites, redirect only to a same-origin path.
import { describe, expect, it, vi } from "vitest";
import { handleAuthCallback, type AuthLike } from "@/src/server/auth-callback";
import { InMemoryStore } from "@/src/store/memory";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "Owner@Example.com", email_confirmed_at: "2026-10-19T08:00:00Z" };

function setup(over: Partial<AuthLike> = {}) {
  const store = new InMemoryStore();
  const claim = vi.spyOn(store, "claimAccountInvites");
  const auth: AuthLike = {
    exchangeCodeForSession: vi.fn(async () => ({ data: { user: USER }, error: null })),
    verifyOtp: vi.fn(async () => ({ data: { user: USER }, error: null })),
    ...over,
  };
  const run = (query: string) => handleAuthCallback(new URL(`https://getclaudia.app/auth/callback${query}`), { auth, store });
  return { store, claim, auth, run };
}

describe("handleAuthCallback", () => {
  it("exchanges the code, claims the invites for the user's email and goes to /dashboard", async () => {
    const { store, claim, auth, run } = setup();
    const v = await store.createVenue({ slug: "cb1", name: "A" });
    await store.createPendingAccountInvite(v.id, "owner@example.com");
    const res = await run("?code=abc");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(claim).toHaveBeenCalledWith(USER.id, USER.email);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://getclaudia.app/dashboard");
    expect(await store.isVenueOwner(v.id, USER.id)).toBe(true);
  });

  it("goes to a same-origin next path", async () => {
    const { run } = setup();
    const res = await run("?code=abc&next=%2Fadmin%2Fcoffique%3Fkey%3D1");
    expect(res.headers.get("location")).toBe("https://getclaudia.app/admin/coffique?key=1");
  });

  it.each(["//evil.example", "https://evil.example", "/\\evil.example", "javascript:alert(1)"])("ignores an off-site next (%s)", async (next) => {
    const { run } = setup();
    const res = await run(`?code=abc&next=${encodeURIComponent(next)}`);
    expect(res.headers.get("location")).toBe("https://getclaudia.app/dashboard");
  });

  it("signs in a magic link made with a token hash (the invite email)", async () => {
    const { auth, claim, run } = setup();
    const res = await run("?token_hash=hashed&type=magiclink&next=%2Fdashboard");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "hashed", type: "magiclink" });
    expect(claim).toHaveBeenCalledWith(USER.id, USER.email);
    expect(res.headers.get("location")).toBe("https://getclaudia.app/dashboard");
  });

  it("refuses a token hash type other than magiclink or email", async () => {
    const { auth, run } = setup();
    const res = await run("?token_hash=hashed&type=recovery");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://getclaudia.app/login?error=1");
  });

  it("sends a visit with neither code nor token hash back to /login", async () => {
    const { auth, claim, run } = setup();
    const res = await run("?next=%2Fdashboard");
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://getclaudia.app/login?error=1");
  });

  it("sends a failed exchange back to /login without claiming anything", async () => {
    const { claim, run } = setup({ exchangeCodeForSession: vi.fn(async () => ({ data: { user: null }, error: { message: "bad code" } })) });
    const res = await run("?code=abc");
    expect(claim).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://getclaudia.app/login?error=1");
  });

  it("never lets an exception out: a throwing exchange is a failed sign-in", async () => {
    const { run } = setup({ exchangeCodeForSession: vi.fn(async () => { throw new Error("boom"); }) });
    const res = await run("?code=abc");
    expect(res.headers.get("location")).toBe("https://getclaudia.app/login?error=1");
  });

  it("does not claim for an email Supabase has not confirmed", async () => {
    const { claim, run } = setup({ exchangeCodeForSession: vi.fn(async () => ({ data: { user: { ...USER, email_confirmed_at: undefined } }, error: null })) });
    const res = await run("?code=abc");
    expect(claim).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://getclaudia.app/dashboard"); // still signed in
  });

  it("still signs the user in when claiming fails", async () => {
    const { store, run } = setup();
    vi.spyOn(store, "claimAccountInvites").mockRejectedValue(new Error("db down"));
    const res = await run("?code=abc");
    expect(res.headers.get("location")).toBe("https://getclaudia.app/dashboard");
  });
});
