// test/email.test.ts — sendEmail: Resend's HTTP API, fetch mocked.
import { describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/src/server/email";

const MSG = { to: "owner@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi" };
const CFG = { apiKey: "re_secret_key", from: "Claudia <hello@getclaudia.app>" };
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("sendEmail", () => {
  it("POSTs the message to Resend with the key as a bearer token", async () => {
    const f = reply(200, { id: "em_1" });
    expect(await sendEmail(MSG, CFG, f as unknown as typeof fetch)).toEqual({ status: "sent", id: "em_1" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_secret_key");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ from: CFG.from, to: ["owner@example.com"], subject: "Hi", html: "<p>Hi</p>", text: "Hi" });
  });

  it("is disabled, and sends nothing, without a key", async () => {
    const f = reply(200, {});
    expect(await sendEmail(MSG, { ...CFG, apiKey: null }, f as unknown as typeof fetch)).toEqual({ status: "disabled" });
    expect(f).not.toHaveBeenCalled();
  });

  it("reports Resend's refusal without the key or the message body", async () => {
    const f = reply(422, { name: "validation_error", message: "Invalid `to` field" });
    const r = await sendEmail(MSG, CFG, f as unknown as typeof fetch);
    expect(r).toEqual({ status: "failed", error: "Resend 422: Invalid `to` field" });
    expect(JSON.stringify(r)).not.toContain("re_secret_key");
  });

  it("reports a network failure without leaking the key", async () => {
    const f = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED while sending Bearer re_secret_key");
    });
    const r = await sendEmail(MSG, CFG, f as unknown as typeof fetch);
    expect(r.status).toBe("failed");
    expect(JSON.stringify(r)).not.toContain("re_secret_key");
  });

  it("copes with a non-JSON error body", async () => {
    const f = vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await sendEmail(MSG, CFG, f as unknown as typeof fetch)).toEqual({ status: "failed", error: "Resend 502" });
  });

  it("gives the request a 10 s abort signal and reports an abort as the network failure", async () => {
    const f = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect([url, init?.signal][1]).toBeInstanceOf(AbortSignal);
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const r = await sendEmail(MSG, CFG, f as unknown as typeof fetch);
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(r).toEqual({ status: "failed", error: "Resend request failed (network error)" });
    timeout.mockRestore();
  });
});
