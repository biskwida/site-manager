// test/auth-callback-route.test.ts — the route wrapper: without Supabase env the callback goes to /login?error=1.
import { describe, expect, it, vi } from "vitest";

const getServerDeps = vi.fn();
vi.mock("@/src/server/session", () => ({ createSessionClient: vi.fn(async () => null) }));
vi.mock("@/src/server/deps", () => ({ getServerDeps: (...a: unknown[]) => getServerDeps(...a) }));
vi.mock("next/server", () => ({ after: vi.fn() }));

import { GET } from "@/app/auth/callback/route";

describe("GET /auth/callback without Supabase env", () => {
  it("redirects to /login?error=1 and builds no server deps", async () => {
    const res = await GET(new Request("https://getclaudia.app/auth/callback?code=abc&next=%2Fdashboard"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://getclaudia.app/login?error=1");
    expect(getServerDeps).not.toHaveBeenCalled();
  });
});
