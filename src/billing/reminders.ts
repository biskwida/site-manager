// src/billing/reminders.ts
// Server-only. The free trial's end, run from the tick (src/tick.ts): pause trials that ran out, and send the two reminders once each.
// Paused never means offline: pausing only stops NEW owner proposals (src/billing/entitlements.ts); nothing here touches a site, a menu or a post.
import { copy, dayMonthLabel } from "../bot/copy";
import type { Messenger } from "../bot/messenger";
import { baseLang } from "../domain/format";
import type { Lang, TrialReminder, Venue } from "../domain/types";
import type { EmailMessage, EmailResult } from "../server/email";
import type { Store } from "../store/types";
import { localDate } from "../time";
import { billingUrl, effectiveLimit, freeTrialOver, TRIAL_SOON_DAYS, TRIAL_SOON_SHARE, type BillingConfig } from "./entitlements";
import { trialDaysLeft } from "./plans";

/** What the tick needs to run the trial end. `ownerEmails` lists the sign-in emails of a venue's account owners (none in memory mode). */
export interface TrialBilling {
  config: BillingConfig;
  ownerEmails: (venueId: string) => Promise<string[]>;
  sendEmail: (msg: EmailMessage) => Promise<EmailResult>;
  /** False when no email can go out (no RESEND_API_KEY): a reminder with no chat to go to is then not claimed, so a later tick retries. Default true. */
  emailEnabled?: boolean;
}

export interface ReminderDeps {
  store: Store;
  messenger: Messenger | null;
  billing: TrialBilling;
  /** Only this venue (the per-webhook tick). */
  venueId?: string;
}

async function venuesOf(d: ReminderDeps): Promise<Venue[]> {
  return d.venueId ? [await d.store.getVenue(d.venueId)] : d.store.listVenues();
}

/**
 * Pauses every venue whose free trial ran out (billing_status trialing, no Stripe subscription, trial_ends_at passed). Idempotent: the
 * store's update is conditional, so a second tick, or the Stripe webhook racing it, changes nothing twice. A venue with a Stripe
 * subscription (even one in Stripe's own trial) is left alone: the webhook owns it. Returns the ids paused by this call.
 */
export async function pauseExpiredTrials(d: ReminderDeps, now: Date): Promise<string[]> {
  if (!d.billing.config.billingEnabled) return [];
  const paused: string[] = [];
  for (const v of await venuesOf(d)) {
    if (!freeTrialOver(v, now)) continue;
    try {
      if (await d.store.pauseExpiredTrial(v.id, now.toISOString())) paused.push(v.id);
    } catch (e) {
      console.error(`[tick] pause trial ${v.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return paused;
}

type Why = "days" | "used" | "limit" | "time";

/** Which reminder is due for this venue now (null = none), the reason that decides its words and the trial limit the words quote (null = not limit-based). */
type Due = { kind: TrialReminder; why: Why; used: number; limit: number | null };

async function dueReminder(d: ReminderDeps, v: Venue, now: Date): Promise<Due | null> {
  if (v.status !== "live" || v.stripe_subscription_id !== null || v.trial_started_at === null || v.trial_ends_at === null) return null;
  if (v.billing_status !== "trialing" && v.billing_status !== "paused") return null;
  if (v.trial_reminder_sent === "ended") return null;
  const over = Date.parse(v.trial_ends_at) <= now.getTime();
  if (v.billing_status === "paused" && !over) return null; // paused by hand or by Stripe, not by the trial running out
  if (over) return { kind: "ended", why: "time", used: 0, limit: null };
  // The same limit the agent enforces (effectiveLimit): the free trial's, counted over the whole trial. A venue whose own change_limit
  // overrides it has no trial limit, so only the day-based reminders apply to it.
  const eff = effectiveLimit(v, d.billing.config, now);
  const limit = eff.kind === "trial" && eff.window && eff.limit !== null && eff.limit > 0 ? eff.limit : null;
  const used = limit !== null && eff.window ? await d.store.countAppliedChangeSets(v.id, eff.window.from, eff.window.to) : 0;
  if (limit !== null && used >= limit) return { kind: "ended", why: "limit", used, limit };
  if (v.trial_reminder_sent !== null) return null;
  if (trialDaysLeft(v, now) <= TRIAL_SOON_DAYS) return { kind: "soon", why: "days", used, limit };
  if (limit !== null && used >= Math.ceil(limit * TRIAL_SOON_SHARE)) return { kind: "soon", why: "used", used, limit };
  return null;
}

function reminderLine(lang: Lang, due: Due, v: Venue, config: BillingConfig, now: Date): string {
  const c = copy(lang);
  const url = billingUrl(config, v.slug);
  if (due.why === "limit") return c.trialLimitReached(due.limit ?? config.trialChangeLimit, url);
  if (due.why === "time") return c.trialEnded(url, v.site_mode === "none");
  if (due.why === "used") return c.trialChangesSoon(due.used, due.limit ?? config.trialChangeLimit, url);
  return c.trialEndsSoon(trialDaysLeft(v, now), dayMonthLabel(localDate(new Date(v.trial_ends_at as string), v.tz), lang), url);
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The reminder as a short email: the same line as the chat, in the owner's language. */
function reminderEmail(lang: Lang, kind: TrialReminder, venueName: string, line: string): Omit<EmailMessage, "to"> {
  const subject = kind === "soon" ? (lang === "bg" ? "Пробният ви период в Claudia свършва скоро" : "Your Claudia free trial is ending soon") : lang === "bg" ? "Пробният ви период в Claudia приключи" : "Your Claudia free trial has ended";
  const hello = lang === "bg" ? `Здравейте! Съобщение от Claudia за ${venueName}.` : `Hello! A note from Claudia about ${venueName}.`;
  const html = `<p>${escapeHtml(hello)}</p><p>${escapeHtml(line).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`;
  return { subject, text: `${hello}\n\n${line}\n`, html };
}

/**
 * The two trial reminders, each sent once and marked in `trial_reminder_sent` with a conditional update (two ticks cannot both send):
 *  - "soon": 3 days before the trial ends, or when 15 of the 20 trial changes are used, whichever comes first;
 *  - "ended": when the trial ends, or when the 20th change is used.
 * Each goes as a chat message to the owner members (their chat language, BG or EN; the messenger translates other languages) and as an
 * email to the account owners. A venue nobody can be told about (no owner chat, no account email) is skipped without being marked,
 * so the next tick tries again. Returns how many reminders this call claimed and sent.
 */
export async function sendTrialReminders(d: ReminderDeps, now: Date): Promise<number> {
  if (!d.billing.config.billingEnabled) return 0;
  let sent = 0;
  for (const v of await venuesOf(d)) {
    try {
      const due = await dueReminder(d, v, now);
      if (!due) continue;
      const owners = (await d.store.listMembers(v.id)).filter((m) => m.role === "owner");
      const emails = await d.billing.ownerEmails(v.id).catch(() => [] as string[]);
      const chats = d.messenger ? owners : [];
      const mailable = d.billing.emailEnabled !== false ? emails : [];
      // Nothing can be delivered (no owner chat or no messenger, and no email address or no mail service): not claimed, so a later tick retries.
      if (chats.length === 0 && mailable.length === 0) continue;
      // The claim comes before any send: at most once, even if a send fails or two ticks overlap.
      if (!(await d.store.claimTrialReminder(v.id, due.kind))) continue;
      sent++;
      let chatsSent = 0;
      let chatsFailed = 0;
      for (const m of chats) {
        try {
          await d.messenger!.send(m.chat_ref, reminderLine(baseLang(m.lang), due, v, d.billing.config, now), { proactive: true });
          chatsSent++;
        } catch {
          chatsFailed++;
        }
      }
      const lang: Lang = owners[0] ? baseLang(owners[0].lang) : v.default_lang;
      const mail = reminderEmail(lang, due.kind, v.name, reminderLine(lang, due, v, d.billing.config, now));
      const mails = { sent: 0, disabled: 0, failed: 0 };
      for (const to of mailable) mails[(await d.billing.sendEmail({ to, ...mail })).status]++;
      // Only counts and statuses: never an address, never the provider's error text.
      const line = `[tick] trial reminder "${due.kind}" for venue ${v.id}: chats sent ${chatsSent}, failed ${chatsFailed}; emails sent ${mails.sent}, disabled ${mails.disabled}, failed ${mails.failed}`;
      if (chatsFailed > 0 || mails.failed > 0 || mails.disabled > 0) console.error(line);
      else console.log(line);
    } catch (e) {
      console.error(`[tick] trial reminder for ${v.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return sent;
}
