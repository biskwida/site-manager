"use client";
// app/start/StartVenueForm.tsx — the form of path B ("I already have a website") and C ("only social media"). Posts to /api/start/venue and
// goes to the new venue's checklist. Every field has a visible label; a wrong field is named in text and linked with aria-describedby.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { btnGhost, btnPrimary, eyebrowCls, inputCls } from "@/app/components/account-ui";
import type { PageLang } from "@/src/auth/page-lang";
import { withLang } from "@/src/auth/start-links";
import { ONBOARDING, type OnboardingKey } from "@/src/i18n/onboarding";
import { SITE_PLATFORMS } from "@/src/domain/types";

type FieldErrors = Partial<Record<string, string>>;
const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

function FieldError({ k, message }: { k: string; message?: string }) {
  return message ? <span id={`err-${k}`} className="mt-1 block text-sm text-[var(--cl-error)]">{message}</span> : null;
}

/** POST /api/start/venue: where to go on success, the wrong fields (in `lang`) when the server named some, or just the status. */
export async function postStartVenue(f: typeof fetch, payload: Record<string, string>): Promise<{ ok: true; to: string } | { ok: false; status: number; fields?: FieldErrors }> {
  const lang = payload.lang === "en" ? "en" : "bg";
  try {
    const res = await f("/api/start/venue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = (await res.json().catch(() => null)) as { onboarding_url?: string; error?: { details?: { path: string; bg: string; en: string }[] } } | null;
    if (res.ok && data?.onboarding_url) return { ok: true, to: data.onboarding_url };
    if (data?.error?.details?.length) return { ok: false, status: res.status, fields: Object.fromEntries(data.error.details.map((d) => [d.path, d[lang]])) };
    return { ok: false, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export function StartVenueForm({ path, lang, backHref, fetcher = defaultFetch, go = (to) => window.location.assign(to) }: { path: "own" | "none"; lang: PageLang; backHref: string; fetcher?: typeof fetch; go?: (to: string) => void }) {
  const t = ONBOARDING[lang];
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});
  const summary = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (failed || Object.keys(fields).length) summary.current?.focus();
  }, [failed, fields]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    const get = (k: string) => String(form.get(k) ?? "");
    setBusy(true);
    setFailed(null);
    setFields({});
    const r = await postStartVenue(fetcher, { path, name: get("name"), address: get("address"), city: get("city"), instagram: get("instagram"), lang, ...(path === "own" ? { site_url: get("site_url"), platform: get("platform") } : {}) });
    if (r.ok) {
      go(withLang(r.to, lang));
      return;
    }
    if (r.fields) setFields(r.fields);
    else setFailed(r.status === 401 ? t["form.errorSignedOut"] : r.status === 429 ? t["form.errorLimit"] : t["form.errorGeneric"]);
    setBusy(false);
  }

  const describe = (k: string, hint?: boolean) => [fields[k] ? `err-${k}` : null, hint ? `hint-${k}` : null].filter(Boolean).join(" ") || undefined;
  const bad = (k: string) => (fields[k] ? true : undefined);
  const message = failed ?? (Object.keys(fields).length ? t["form.fixFields"] : null);

  return (
    <>
      <span className={eyebrowCls}>{path === "own" ? t["form.stepOwn"] : t["form.stepSocial"]}</span>
      <h1 className="mb-6 mt-1 font-display text-4xl leading-tight">{t["form.title"]}</h1>
      <form onSubmit={submit} className="grid max-w-xl gap-4" noValidate>
        {message ? <p ref={summary} tabIndex={-1} role="alert" className="text-sm text-[var(--cl-error)] outline-none">{message}</p> : null}
        <label className="block text-sm font-medium" htmlFor="f-name">
          {t["form.name"]}
          <input id="f-name" name="name" required maxLength={80} autoComplete="organization" aria-invalid={bad("name")} aria-describedby={describe("name")} className={inputCls} />
          <FieldError k="name" message={fields.name} />
        </label>
        {path === "own" ? (
          <>
            <label className="block text-sm font-medium" htmlFor="f-site">
              {t["form.site"]} <span id="hint-site_url" className="font-normal text-[var(--cl-ink-2)]">({t["form.siteHint"]})</span>
              <input id="f-site" name="site_url" required inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="url" aria-invalid={bad("site_url")} aria-describedby={describe("site_url", true)} className={inputCls} />
              <FieldError k="site_url" message={fields.site_url} />
            </label>
            <label className="block text-sm font-medium" htmlFor="f-platform">
              {t["form.platform"]}
              <select id="f-platform" name="platform" defaultValue="wordpress" aria-invalid={bad("platform")} aria-describedby={describe("platform")} className={inputCls}>
                {SITE_PLATFORMS.map((p) => (
                  <option key={p} value={p}>{t[`form.platform.${p}` as OnboardingKey]}</option>
                ))}
              </select>
              <FieldError k="platform" message={fields.platform} />
            </label>
          </>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium" htmlFor="f-address">
            {t["form.address"]} <span id="hint-address" className="font-normal text-[var(--cl-ink-2)]">({t["form.addressHint"]})</span>
            <input id="f-address" name="address" required maxLength={160} autoComplete="street-address" aria-invalid={bad("address")} aria-describedby={describe("address", true)} className={inputCls} />
            <FieldError k="address" message={fields.address} />
          </label>
          <label className="block text-sm font-medium" htmlFor="f-city">
            {t["form.city"]}
            <input id="f-city" name="city" required maxLength={60} autoComplete="address-level2" aria-invalid={bad("city")} aria-describedby={describe("city")} className={inputCls} />
            <FieldError k="city" message={fields.city} />
          </label>
        </div>
        <label className="block text-sm font-medium" htmlFor="f-instagram">
          {t["form.instagram"]} <span id="hint-instagram" className="font-normal text-[var(--cl-ink-2)]">({t["form.instagramHint"]})</span>
          <input id="f-instagram" name="instagram" maxLength={80} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={bad("instagram")} aria-describedby={describe("instagram", true)} className={inputCls} />
          <FieldError k="instagram" message={fields.instagram} />
        </label>
        {path === "own" ? <p className="rounded-xl border border-dashed border-[var(--cl-line)] p-4 text-sm text-[var(--cl-ink-2)]">{t["form.menuNote"]}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? t["form.submitting"] : t["form.submit"]}</button>
          <a href={backHref} className={btnGhost}>{t.back}</a>
        </div>
      </form>
    </>
  );
}
