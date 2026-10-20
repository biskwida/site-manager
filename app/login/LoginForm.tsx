"use client";
// app/login/LoginForm.tsx — email link (signInWithOtp) and Google (signInWithOAuth) through Supabase Auth in the browser.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { LANG_COOKIE, type PageLang } from "@/src/auth/page-lang";
import { LOGIN } from "@/src/i18n/login";
import { sendEmailLink, startGoogle } from "./sign-in";

type Phase = "idle" | "sending" | "sent";

export function LoginForm({ lang, next, rememberLang, initialError }: { lang: PageLang; next: string; rememberLang: boolean; initialError: boolean }) {
  const t = LOGIN[lang];
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(initialError ? t.errorCallback : null);
  const sentRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.documentElement.lang = lang;
    // An explicit ?lang= is remembered for the next visit (the page language reads this cookie second).
    if (rememberLang) {
      try {
        document.cookie = `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      } catch {
        // Cookies blocked: the choice just is not remembered.
      }
    }
  }, [lang, rememberLang]);

  useEffect(() => {
    if (phase === "sent") sentRef.current?.focus();
  }, [phase]);

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    if (phase === "sending") return;
    setError(null);
    setPhase("sending");
    const r = await sendEmailLink({ email, origin: window.location.origin, next });
    if (r.ok) setPhase("sent");
    else {
      setError(t.errorSend);
      setPhase("idle");
    }
  }

  async function google() {
    setError(null);
    const r = await startGoogle({ origin: window.location.origin, next });
    if (!r.ok) setError(t.errorGoogle);
  }

  if (phase === "sent") {
    return (
      <div role="status" className="rounded-2xl border border-[var(--cl-line)] bg-[var(--cl-card)] p-6">
        <h2 ref={sentRef} tabIndex={-1} className="font-display text-2xl outline-none">{t.sentTitle}</h2>
        <p className="mt-3 text-[var(--cl-ink-2)]">{t.sentBody.replace("{email}", () => email.trim())}</p>
        <button type="button" onClick={() => setPhase("idle")} className="mt-5 min-h-11 text-[var(--cl-accent)] underline underline-offset-4 hover:text-[var(--cl-accent-hover)]">{t.another}</button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--cl-line)] bg-[var(--cl-card)] p-6">
      <form onSubmit={sendLink} noValidate={false}>
        <label htmlFor="login-email" className="block text-sm font-medium">{t.emailLabel}</label>
        <input
          id="login-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby={error ? "login-error" : undefined}
          aria-invalid={error ? true : undefined}
          className="mt-1.5 block min-h-12 w-full rounded-xl border border-[var(--cl-line)] bg-white px-4 text-base text-[var(--cl-ink)] placeholder:text-[var(--cl-ink-2)]/60"
          placeholder="name@example.com"
        />
        <button
          type="submit"
          disabled={phase === "sending"}
          className="mt-4 min-h-12 w-full rounded-xl bg-[var(--cl-accent)] px-5 text-base font-medium text-white transition-colors hover:bg-[var(--cl-accent-hover)] disabled:opacity-70"
        >
          {phase === "sending" ? t.sending : t.submit}
        </button>
      </form>
      <div className="my-5 flex items-center gap-3 text-sm text-[var(--cl-ink-2)]" aria-hidden="true">
        <span className="h-px flex-1 bg-[var(--cl-line)]" />
        {t.or}
        <span className="h-px flex-1 bg-[var(--cl-line)]" />
      </div>
      <button
        type="button"
        onClick={google}
        className="min-h-12 w-full rounded-xl border border-[var(--cl-line)] bg-white px-5 text-base font-medium text-[var(--cl-ink)] transition-colors hover:bg-[var(--cl-accent-soft)]"
      >
        {t.google}
      </button>
      {error ? <p id="login-error" role="alert" className="mt-4 text-sm text-[var(--cl-error)]">{error}</p> : null}
    </div>
  );
}
