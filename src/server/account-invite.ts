// src/server/account-invite.ts
// Server-only. `npm run account:invite -- --slug <s> --email <e>` (scripts/account-invite.mts): promise a venue to an email, and mail
// the owner a sign-in link. The link is never printed or logged; it only goes into the email.
import { callbackUrl, DEFAULT_NEXT } from "../auth/next";
import type { Store } from "../store/types";
import type { EmailMessage, EmailResult } from "./email";

export interface InviteAccountDeps {
  store: Pick<Store, "getVenueBySlug" | "createPendingAccountInvite">;
  /** https://<APP_HOST>, no trailing slash. */
  appUrl: string;
  /** Why no mail goes out (the invite is then only stored): no RESEND_API_KEY, or APP_HOST not set explicitly (the link must point at the real host). Null = mail on. */
  emailOff: "no_key" | "no_app_host" | null;
  /** Supabase admin generateLink({ type: "magiclink", email, options: { redirectTo } }): the token hash. Throws on failure. */
  generateLink: (email: string, redirectTo: string) => Promise<{ hashedToken: string | null }>;
  send: (msg: EmailMessage) => Promise<EmailResult>;
}

export type InviteOutcome =
  | { status: "emailed"; venueName: string; email: string }
  | { status: "stored"; venueName: string; email: string; reason: "no_key" | "no_app_host" }
  | { status: "email_failed"; venueName: string; email: string; error: string }
  | { status: "unknown_venue"; slug: string }
  | { status: "bad_email" };

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Stores the pending invite first (the first sign-in with this email claims it whatever happens to the mail), then mails a link.
 * The link goes to /auth/callback with the magic link's token hash (the admin API's own action link returns tokens in the URL
 * fragment, which a server callback never sees, so a missing hash is a failure, not a reason to mail the action link). Never throws: a link or mail failure is an "email_failed" outcome.
 */
export async function inviteAccount(deps: InviteAccountDeps, input: { slug: string; email: string }): Promise<InviteOutcome> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) return { status: "bad_email" };
  const venue = await deps.store.getVenueBySlug(input.slug);
  if (!venue) return { status: "unknown_venue", slug: input.slug };
  await deps.store.createPendingAccountInvite(venue.id, email);
  const base = { venueName: venue.name, email };
  if (deps.emailOff) return { status: "stored", ...base, reason: deps.emailOff };
  try {
    const redirectTo = callbackUrl(deps.appUrl, DEFAULT_NEXT);
    const { hashedToken } = await deps.generateLink(email, redirectTo);
    // No fallback to the admin API's action_link: it returns the session in the URL fragment, which /auth/callback never sees.
    if (!hashedToken) return { status: "email_failed", ...base, error: "no token hash" };
    const link = `${deps.appUrl}/auth/callback?token_hash=${encodeURIComponent(hashedToken)}&type=magiclink&next=${encodeURIComponent(DEFAULT_NEXT)}`;
    const sent = await deps.send({ to: email, ...accountInviteEmail({ venueName: venue.name, link, loginUrl: `${deps.appUrl}/login` }) });
    if (sent.status === "sent") return { status: "emailed", ...base };
    return { status: "email_failed", ...base, error: sent.status === "failed" ? sent.error : "email is not configured" };
  } catch (e) {
    return { status: "email_failed", ...base, error: e instanceof Error ? e.message : "could not make the sign-in link" };
  }
}

/** The mail: Bulgarian first, English under it. Short on purpose. */
export function accountInviteEmail(o: { venueName: string; link: string; loginUrl: string }): Omit<EmailMessage, "to"> {
  const subject = "Влезте в Claudia · Sign in to Claudia";
  const text = [
    `Здравейте! Claudia е готова за ${o.venueName}.`,
    `Влезте с този линк (валиден кратко време): ${o.link}`,
    `Ако е изтекъл, заявете нов на ${o.loginUrl} с този имейл.`,
    "",
    `Hello! Claudia is ready for ${o.venueName}.`,
    `Sign in with this link (valid for a short time): ${o.link}`,
    `If it has expired, ask for a new one at ${o.loginUrl} with this email.`,
  ].join("\n");
  const name = escapeHtml(o.venueName);
  const href = escapeHtml(o.link);
  const login = escapeHtml(o.loginUrl);
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#2a211c;line-height:1.5">
<p>Здравейте! Claudia е готова за <strong>${name}</strong>.</p>
<p><a href="${href}" style="display:inline-block;background:#d9622b;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px">Влезте в Claudia</a></p>
<p style="font-size:14px;color:#6b5d54">Линкът е валиден кратко време. Ако е изтекъл, заявете нов на <a href="${login}">${login}</a> с този имейл.</p>
<hr style="border:none;border-top:1px solid #eadfd5;margin:24px 0">
<p>Hello! Claudia is ready for <strong>${name}</strong>.</p>
<p><a href="${href}" style="display:inline-block;background:#d9622b;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px">Sign in to Claudia</a></p>
<p style="font-size:14px;color:#6b5d54">The link is valid for a short time. If it has expired, ask for a new one at <a href="${login}">${login}</a> with this email.</p>
</div>`;
  return { subject, html, text };
}

/** What the script prints. Never the link, the token or a key. */
export function accountInviteLines(o: InviteOutcome, appUrl: string): string[] {
  switch (o.status) {
    case "unknown_venue":
      return [`no venue with slug "${o.slug}". Create it first with: npm run venue:create`];
    case "bad_email":
      return ["--email must be an email address like owner@example.com"];
    case "emailed":
      return [`${o.venueName}: invite stored for ${o.email}, sign-in link emailed.`, `The first sign-in with that email links the account to the venue.`];
    case "stored":
      if (o.reason === "no_app_host") {
        return [
          `${o.venueName}: invite stored for ${o.email}. No email was sent: APP_HOST is not set in the environment, and the sign-in link must point at the real app host.`,
          `Set APP_HOST (for example getclaudia.app) and run this command again (the stored invite stays), or the owner can sign in at ${appUrl}/login with that email.`,
        ];
      }
      return [
        `${o.venueName}: invite stored for ${o.email}. No email was sent (RESEND_API_KEY is not set).`,
        `The owner can sign in at ${appUrl}/login with that email; the first sign-in links the account to the venue.`,
      ];
    case "email_failed":
      return [
        `${o.venueName}: invite stored for ${o.email}, but the email failed: ${o.error}`,
        `The owner can still sign in at ${appUrl}/login with that email; the first sign-in links the account to the venue.`,
      ];
  }
}
