"use client";
import { useState, type FormEvent } from "react";
import type { DomainInstructions } from "@/src/deploy/types";
import { normalizeDomain } from "@/src/deploy/vercel-domains";
import { useLang } from "@/src/i18n";
import type { AdminOverview, DomainResult } from "@/src/server/admin";
import { Chip, Section } from "./bits";
import type { Post } from "./useAdminOverview";

const isLocalized = (d: unknown): d is { bg: string; en: string } =>
  typeof d === "object" && d !== null && typeof (d as { bg?: unknown }).bg === "string" && typeof (d as { en?: unknown }).en === "string";
const isResult = (d: unknown): d is DomainResult => typeof d === "object" && d !== null && typeof (d as { ok?: unknown }).ok === "boolean";

/** Async clipboard first; embedded browsers that deny it still allow the legacy selection copy. False when both refuse. */
async function writeClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!(await writeClipboard(value))) return; // nothing to announce: the value stays visible to copy by hand
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button type="button" onClick={() => void copy()} aria-label={`${t("admin.copy")}: ${label}`}
      className="min-h-11 min-w-11 rounded-full px-3 text-xs font-semibold text-ink ring-1 ring-ink/25 transition-colors hover:bg-ink/5">
      {copied ? t("admin.copied") : t("admin.copy")}
    </button>
  );
}

/** The records the owner must add at the DNS provider, with the verification outcome above them. Announced to screen readers when it arrives. */
export function DnsRecords({ domain, instructions }: { domain: string; instructions: DomainInstructions }) {
  const { t } = useLang();
  return (
    <div className="mt-4" aria-live="polite">
      <p className={`text-sm font-semibold ${instructions.verified ? "text-ink" : "text-amber"}`}>
        {instructions.verified ? t("admin.domainVerified", { domain }) : t("admin.domainPending")}
      </p>
      <h3 id="dns-records" className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-soft">{t("admin.dns.title")}</h3>
      {/* Long values scroll sideways inside this box (never the page); the Copy column stays pinned so it is reachable on a phone without scrolling. */}
      <div role="region" aria-labelledby="dns-records" tabIndex={0} className="mt-2 overflow-x-auto rounded-2xl bg-paper ring-1 ring-ink/10 focus-visible:outline-2 focus-visible:outline-accent">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ink-soft">
              <th scope="col" className="px-3 py-2">{t("admin.dns.type")}</th>
              <th scope="col" className="px-3 py-2">{t("admin.dns.name")}</th>
              <th scope="col" className="px-3 py-2">{t("admin.dns.value")}</th>
              <th scope="col" className="sticky right-0 bg-paper px-3 py-2"><span className="sr-only">{t("admin.copy")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/10">
            {instructions.records.map((r) => (
              <tr key={`${r.type}-${r.name}-${r.value}`} className="align-top">
                <td className="px-3 py-2.5 font-semibold">{r.type}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{r.name}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{r.value}</td>
                <td className="sticky right-0 bg-paper px-2 py-1.5 text-right shadow-[-8px_0_8px_-8px_rgba(29,42,36,0.25)]"><CopyButton value={r.value} label={`${r.type} ${r.name}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * "Your own domain" (Pro): one input + Connect, then the DNS records with copy buttons and "Check again".
 * Only a published site can take a domain; the stored domain and its last verification survive a reload through the overview.
 */
export function DomainCard({ overview: o, post }: { overview: AdminOverview; post: Post }) {
  const { lang, t } = useLang();
  const [domain, setDomain] = useState(o.custom_domain ?? "");
  const [busy, setBusy] = useState<"add" | "check" | null>(null);
  const [result, setResult] = useState<DomainResult | null>(null);
  const deployed = o.deploy?.status === "ready";

  async function run(kind: "add" | "check", body: Record<string, unknown>) {
    setBusy(kind);
    setResult(null);
    const r = await post(body);
    setResult(isResult(r.data) ? r.data : { ok: false, code: "provider", error: "failed", bg: t("admin.failed"), en: t("admin.failed") });
    setBusy(null);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !deployed) return;
    const clean = normalizeDomain(domain);
    if (!clean) {
      setResult({ ok: false, code: "invalid_domain", error: "Invalid domain.", bg: t("admin.domainInvalid"), en: t("admin.domainInvalid") });
      return;
    }
    setDomain(clean);
    void run("add", { action: "add_domain", domain: clean });
  }
  const errorText = result && !result.ok ? (isLocalized(result) ? result[lang] : t("admin.failed")) : null;

  return (
    <Section id="domain" title={t("admin.domain")}>
      <div className="rounded-3xl bg-card p-4 ring-1 ring-ink/10 sm:p-5">
        <p className="text-sm text-ink-soft">{t("admin.domainLead")}</p>
        {o.custom_domain && (
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold [overflow-wrap:anywhere]">
            <span>{t("admin.domainCurrent", { domain: o.custom_domain })}</span>
            <Chip tone={o.domain_verified ? "good" : "warn"}>{o.domain_verified ? t("admin.domainStatus.verified") : t("admin.domainStatus.pending")}</Chip>
          </p>
        )}
        <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-2">
          <label htmlFor="domain-input" className="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-sm font-semibold">
            {t("admin.domainLabel")}
            <input id="domain-input" type="text" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="cafe.example.com" required
              value={domain} onChange={(e) => { setDomain(e.target.value); if (result && !result.ok) setResult(null); }} disabled={busy !== null}
              aria-invalid={result?.ok === false && result.code === "invalid_domain" ? true : undefined} aria-describedby="domain-status"
              className="min-h-11 w-full rounded-xl bg-paper px-3 text-base font-normal text-ink ring-1 ring-ink/20 placeholder:text-ink-soft/60 disabled:opacity-60" />
          </label>
          <button type="submit" disabled={busy !== null || !deployed} aria-busy={busy === "add"}
            className="min-h-11 rounded-full bg-accent px-5 text-sm font-semibold text-white transition-[transform,filter] duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-60 disabled:hover:brightness-100 disabled:active:scale-100">
            {busy === "add" ? t("admin.busy") : t("admin.domainAdd")}
          </button>
          {o.custom_domain && (
            <button type="button" disabled={busy !== null || !deployed} aria-busy={busy === "check"} onClick={() => void run("check", { action: "check_domain" })}
              className="min-h-11 rounded-full px-5 text-sm font-semibold text-ink ring-1 ring-ink/25 transition-colors hover:bg-ink/5 disabled:opacity-60">
              {busy === "check" ? t("admin.busy") : t("admin.domainCheck")}
            </button>
          )}
        </form>
        <div id="domain-status">
          {!deployed && <p className="mt-2 text-sm text-ink-soft">{t("admin.domainNeedsSite")}</p>}
          {errorText && <p role="alert" className="mt-3 text-sm font-semibold text-clay">{errorText}</p>}
        </div>
        {result?.ok && <DnsRecords domain={result.domain} instructions={result.instructions} />}
      </div>
    </Section>
  );
}
