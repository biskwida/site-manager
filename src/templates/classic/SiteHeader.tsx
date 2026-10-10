"use client";
import Link from "next/link";
import type { SiteState } from "@/src/domain/types";
import { LangToggle, useLang } from "@/src/i18n";
import { pageHref } from "../shared/links";
import { mediaUrl, SiteImage } from "./bits";

export function SiteHeader({ state, slug, page, preview = false }: { state: SiteState; slug: string; page: "home" | "menu"; preview?: boolean }) {
  const { lang, t } = useLang();
  const v = state.venue;
  const cover = mediaUrl(state, v.cover_media_id, preview);
  const logo = mediaUrl(state, v.logo_media_id, preview);
  const tagline = lang === "bg" ? v.tagline_bg : v.tagline_en;
  const welcome = state.texts.find((x) => x.key === "welcome");
  const welcomeText = welcome ? (lang === "bg" ? welcome.text_bg : welcome.text_en) || welcome.text_bg : "";
  const links = [
    { href: pageHref(slug, "home"), label: t("site.home"), current: page === "home" },
    { href: pageHref(slug, "menu"), label: t("site.menu"), current: page === "menu" },
  ];
  return (
    <header className={`relative isolate overflow-hidden ${cover ? "min-h-[40vh] text-white" : "bg-accent-soft text-ink"}`}>
      {cover && (
        <>
          <SiteImage src={cover} alt="" sizes="100vw" priority />
          {/* darkens the photo so white text keeps AA contrast on any cover */}
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/45 to-black/30" />
        </>
      )}
      <div className="relative mx-auto flex w-full max-w-3xl flex-col px-4 pb-8 pt-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <nav aria-label={t("site.nav")} className="flex gap-1">
            {links.map((l) => (
              <Link key={l.href} href={l.href} aria-current={l.current ? "page" : undefined}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${l.current ? (cover ? "bg-white text-ink" : "bg-ink text-paper") : cover ? "text-white hover:bg-white/15" : "text-ink-soft hover:bg-ink/5 hover:text-ink"}`}>
                {l.label}
              </Link>
            ))}
          </nav>
          <LangToggle />
        </div>
        <div className={`flex items-center gap-4 ${cover ? "mt-auto pt-16" : "pt-8"}`}>
          <div className="relative size-16 shrink-0 overflow-hidden rounded-full bg-accent ring-4 ring-white/80 sm:size-20">
            {logo ? (
              <SiteImage src={logo} alt={v.name} sizes="80px" />
            ) : (
              <span aria-hidden="true" className="flex size-full items-center justify-center font-display text-3xl font-semibold text-white">{v.name.charAt(0)}</span>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold leading-tight text-balance sm:text-4xl">{v.name}</h1>
            {tagline && <p className={`mt-1 text-base ${cover ? "text-white/90" : "text-ink-soft"}`}>{tagline}</p>}
          </div>
        </div>
        {page === "home" && welcomeText && <p className={`mt-5 max-w-xl text-base ${cover ? "text-white/90" : "text-ink"}`}>{welcomeText}</p>}
      </div>
    </header>
  );
}
