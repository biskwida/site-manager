// test/auth-signout.test.ts — POST /auth/signout signs out and redirects to /.
import { describe, expect, it, vi } from "vitest";

const signOut = vi.fn(async (opts?: { scope: string }) => (void opts, { error: null }));
const createSessionClient = vi.fn(async (): Promise<{ auth: { signOut: typeof signOut } } | null> => ({ auth: { signOut } }));
vi.mock("@/src/server/session", () => ({ createSessionClient: () => createSessionClient() }));

import { POST } from "@/app/auth/signout/route";

describe("POST /auth/signout", () => {
  it("signs out and redirects to /", async () => {
    const res = await POST(new Request("https://getclaudia.app/auth/signout", { method: "POST" }));
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://getclaudia.app/");
  });

  it("still redirects when Supabase is not configured or sign-out throws", async () => {
    createSessionClient.mockResolvedValueOnce(null);
    expect((await POST(new Request("https://getclaudia.app/auth/signout", { method: "POST" }))).headers.get("location")).toBe("https://getclaudia.app/");
    signOut.mockRejectedValueOnce(new Error("network"));
    expect((await POST(new Request("https://getclaudia.app/auth/signout", { method: "POST" }))).headers.get("location")).toBe("https://getclaudia.app/");
  });
});
