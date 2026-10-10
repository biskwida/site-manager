"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { Lang } from "../domain/types";
import { DICTS, type MessageKey } from "./dicts";

const STORAGE_KEY = "site-manager.lang";
type Vars = Record<string, string | number>;

function interpolate(s: string, vars?: Vars) {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}
function isLang(v: unknown): v is Lang {
  return v === "bg" || v === "en";
}
/** The visitor's explicit choice this session; wins over the URL and storage, and survives blocked storage. */
let chosen: Lang | null = null;
const listeners = new Set<() => void>();

/** `?lang=` beats the saved choice; null means "use the server default". Pure: safe as a snapshot. */
function readOverride(): Lang | null {
  if (chosen) return chosen;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("lang");
    if (isLang(fromUrl)) return fromUrl;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return isLang(saved) ? saved : null;
  } catch {
    return null;
  }
}
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}
/** The server (and hydration) never knows the visitor's choice, so it renders the default. */
const serverOverride = () => null;

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  locale: string;
}
const LangContext = createContext<LangContextValue | null>(null);

/** `defaultLang` is the server-known default (venue default_lang or "en" for the landing); the visitor's choice overrides it after hydration. */
export function LangProvider({ defaultLang, children }: { defaultLang: Lang; children: ReactNode }) {
  const lang = useSyncExternalStore(subscribe, readOverride, serverOverride) ?? defaultLang;
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    // A `?lang=` link remembers its language for the next visit.
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("lang");
      if (isLang(fromUrl)) window.localStorage.setItem(STORAGE_KEY, fromUrl);
    } catch {
      // storage blocked: nothing to remember
    }
  }, []);
  const setLang = useCallback((next: Lang) => {
    chosen = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      const url = new URL(window.location.href);
      if (url.searchParams.has("lang")) {
        url.searchParams.set("lang", next);
        window.history.replaceState(window.history.state, "", url);
      }
    } catch {
      // storage blocked: the choice just won't survive a reload
    }
    listeners.forEach((l) => l());
  }, []);
  const value = useMemo<LangContextValue>(() => ({ lang, setLang, t: (k, v) => interpolate(DICTS[lang][k], v), locale: lang === "bg" ? "bg-BG" : "en-GB" }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used inside <LangProvider>");
  return ctx;
}

/** EN / БГ segmented control; each language named in itself. */
export function LangToggle({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useLang();
  const options: { value: Lang; label: string; name: string }[] = [
    { value: "bg", label: "БГ", name: "български" },
    { value: "en", label: "EN", name: "English" },
  ];
  return (
    <div role="group" aria-label={t("lang.group")} className={`inline-flex shrink-0 rounded-full bg-card p-1 ring-1 ring-ink/10 ${className}`}>
      {options.map((o) => {
        const active = lang === o.value;
        return (
          <button key={o.value} type="button" lang={o.value} aria-pressed={active} onClick={() => setLang(o.value)}
            className={`min-h-8 min-w-10 rounded-full px-2.5 text-sm font-semibold transition-colors ${active ? "bg-ink text-paper" : "text-ink/70 hover:bg-ink/5 hover:text-ink"}`}>
            {o.label}
            <span className="sr-only">, {o.name}</span>
          </button>
        );
      })}
    </div>
  );
}
