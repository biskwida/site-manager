// src/server/email.ts
// Server-only. Mail through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email). One function, reused by every
// sender (the account:invite sign-in link, later receipts). The key comes from env (RESEND_API_KEY) via the caller; nothing here logs
// or returns it, the message body or a link.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}
export interface EmailConfig {
  /** RESEND_API_KEY; null means nothing is sent. */
  apiKey: string | null;
  /** The From header, e.g. "Claudia <hello@getclaudia.app>" (EMAIL_FROM). */
  from: string;
}
export type EmailResult = { status: "sent"; id?: string } | { status: "disabled" } | { status: "failed"; error: string };

export const RESEND_URL = "https://api.resend.com/emails";

/** "sent", "disabled" (no key: nothing was attempted) or "failed" with a short reason (HTTP status and Resend's message). Never throws. */
export async function sendEmail(msg: EmailMessage, cfg: EmailConfig, fetchFn: typeof fetch = fetch): Promise<EmailResult> {
  if (!cfg.apiKey) return { status: "disabled" };
  try {
    const res = await fetchFn(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: cfg.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
      signal: AbortSignal.timeout(10_000), // a hung Resend never hangs a request or the script; the abort is the network failure below
    });
    const body = (await res.json().catch(() => null)) as { id?: unknown; message?: unknown } | null;
    if (!res.ok) return { status: "failed", error: `Resend ${res.status}${typeof body?.message === "string" ? `: ${body.message}` : ""}` };
    return typeof body?.id === "string" ? { status: "sent", id: body.id } : { status: "sent" };
  } catch {
    // The error text of a failed fetch can echo request details: keep only that it failed.
    return { status: "failed", error: "Resend request failed (network error)" };
  }
}
