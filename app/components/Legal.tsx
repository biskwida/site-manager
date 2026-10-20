"use client";
// The public privacy policy and data deletion pages (app/privacy, app/data-deletion). The policy text lives in src/i18n/dicts.ts
// (privacy.* / deletion.*) and is a DRAFT for the owner's review before Meta App Review; nothing on the page says so.
import Link from "next/link";
import type { ReactNode } from "react";
import { LangToggle, useLang } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/dicts";

export interface DeletionStatusProps {
  code: string;
  /** null = no request with this code. */
  status: { status: "pending" | "completed"; created_at: string; completed_at: string | null } | null;
}

/** YYYY-MM-DD in UTC: the same on the server and in the browser (no hydration mismatch across time zones). */
const day = (iso: string) => iso.slice(0, 10);

function Shell({ titleKey, children }: { titleKey: MessageKey; children: ReactNode }) {
  const { t } = useLang();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <Link href="/" className="font-display text-lg font-semibold">{t("legal.home")}</Link>
        <LangToggle />
      </header>
      <h1 className="mt-6 text-3xl font-semibold leading-tight sm:text-4xl">{t(titleKey)}</h1>
      <p className="mt-2 text-sm text-ink-soft">{t("legal.updated")}</p>
      <div className="mt-8 space-y-10 leading-relaxed">{children}</div>
      <LegalLinks className="mt-16" />
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-3 space-y-3 text-ink-soft">{children}</div>
    </section>
  );
}

function Contact({ email }: { email: string | null }) {
  const { t } = useLang();
  return email ? <a href={`mailto:${email}`} className="font-semibold text-accent underline-offset-4 hover:underline">{email}</a> : <span>{t("privacy.contact.none")}</span>;
}

/** "Поверителност · Изтриване на данни": the landing footer and both pages. */
export function LegalLinks({ className = "" }: { className?: string }) {
  const { t } = useLang();
  return (
    <nav className={`flex flex-wrap items-center gap-x-2 text-sm text-ink-soft ${className}`}>
      <Link href="/privacy" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">{t("legal.privacy")}</Link>
      <span aria-hidden="true">·</span>
      <Link href="/data-deletion" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">{t("legal.deletion")}</Link>
    </nav>
  );
}

const DATA_ITEMS = ["privacy.data.1", "privacy.data.2", "privacy.data.3", "privacy.data.4", "privacy.data.5", "privacy.data.6", "privacy.data.7"] as const;
const THIRD_PARTIES = ["privacy.third.meta", "privacy.third.telegram", "privacy.third.anthropic", "privacy.third.stt", "privacy.third.vercel", "privacy.third.supabase", "privacy.third.stripe", "privacy.third.resend"] as const;
const ACCOUNT_ITEMS = ["privacy.accounts.1", "privacy.accounts.2", "privacy.accounts.3", "privacy.accounts.4"] as const;

export function PrivacyPolicy({ contactEmail }: { contactEmail: string | null }) {
  const { t } = useLang();
  return (
    <Shell titleKey="privacy.title">
      <p className="text-lg">{t("privacy.intro")}</p>
      <Section title={t("privacy.who.title")}>
        <p>{t("privacy.who.body")}</p>
        <p>{t("privacy.contact.label")} <Contact email={contactEmail} /></p>
      </Section>
      <Section title={t("privacy.data.title")}>
        <ul className="list-disc space-y-2 pl-5">{DATA_ITEMS.map((k) => <li key={k}>{t(k)}</li>)}</ul>
      </Section>
      <Section title={t("privacy.why.title")}><p>{t("privacy.why.body")}</p></Section>
      <Section title={t("privacy.meta.title")}><p>{t("privacy.meta.body")}</p></Section>
      <Section title={t("privacy.where.title")}><p>{t("privacy.where.body")}</p></Section>
      <Section title={t("privacy.third.title")}>
        <ul className="list-disc space-y-2 pl-5">{THIRD_PARTIES.map((k) => <li key={k}>{t(k)}</li>)}</ul>
      </Section>
      {/* OWNER REVIEW REQUIRED before BILLING_ENABLED goes on: this section (privacy.accounts.* in src/i18n/dicts.ts) is a factual draft. */}
      <Section title={t("privacy.accounts.title")}>
        <ul className="list-disc space-y-2 pl-5">{ACCOUNT_ITEMS.map((k) => <li key={k}>{t(k)}</li>)}</ul>
      </Section>
      <Section title={t("privacy.retention.title")}><p>{t("privacy.retention.body")}</p></Section>
      <Section title={t("privacy.rights.title")}>
        <p>{t("privacy.rights.body")}</p>
        <p>{t("privacy.contact.label")} <Contact email={contactEmail} /></p>
      </Section>
      <Section title={t("privacy.delete.title")}>
        <p>{t("privacy.delete.body")}</p>
        <p><Link href="/data-deletion" className="font-semibold text-accent underline-offset-4 hover:underline">{t("privacy.delete.link")}</Link></p>
      </Section>
    </Shell>
  );
}

export function DataDeletion({ contactEmail, lookup }: { contactEmail: string | null; lookup: DeletionStatusProps | null }) {
  const { t } = useLang();
  return (
    <Shell titleKey="deletion.title">
      <p className="text-lg">{t("deletion.intro")}</p>
      {lookup && <StatusCard lookup={lookup} />}
      <Section title={t("deletion.way1.title")}><p>{t("deletion.way1.body")}</p></Section>
      <Section title={t("deletion.way2.title")}><p>{t("deletion.way2.body")}</p></Section>
      <Section title={t("deletion.way3.title")}>
        <p>{t("deletion.way3.body")}</p>
        <p>{t("deletion.way3.contact")} <Contact email={contactEmail} /></p>
      </Section>
      <Section title={t("deletion.status.title")}>
        <form method="get" action="/data-deletion" className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span>{t("deletion.status.label")}</span>
            <input name="code" required maxLength={32} autoComplete="off" spellCheck={false} defaultValue={lookup?.code ?? ""}
              className="min-h-11 rounded-xl bg-card px-3 font-mono uppercase text-ink ring-1 ring-ink/15" />
          </label>
          <button type="submit" className="min-h-11 rounded-full bg-accent px-5 font-semibold text-white">{t("deletion.status.check")}</button>
        </form>
      </Section>
    </Shell>
  );
}

function StatusCard({ lookup }: { lookup: DeletionStatusProps }) {
  const { t } = useLang();
  const s = lookup.status;
  const line = !s
    ? t("deletion.status.unknown")
    : s.status === "completed"
      ? t("deletion.status.completed", { date: day(s.completed_at ?? s.created_at) })
      : t("deletion.status.pending", { date: day(s.created_at) });
  return (
    <section role="status" className="rounded-3xl bg-card p-5 ring-1 ring-ink/10">
      <h2 className="text-lg font-semibold">{t("deletion.status.title")}</h2>
      {s && <p className="mt-2 font-mono text-sm">{t("deletion.status.code", { code: lookup.code })}</p>}
      <p className="mt-2">{line}</p>
    </section>
  );
}
