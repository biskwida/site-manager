"use client";
import type { CSSProperties } from "react";
import { useLang } from "@/src/i18n";
import type { TemplateProps } from "../index";
import { capAccent, ensureContrast, mixHex } from "../shared/color";
import { mediaUrl } from "../shared/media";
import { useLiveSite, useNow } from "../shared/useLiveSite";
import { menuSections, type MediaLookup } from "./bits";
import { fontVars } from "./fonts";
import { ActionBar, Footer } from "./Footer";
import { Gallery } from "./Gallery";
import { Header } from "./Header";
import { Hero } from "./Hero";
import { FullMenu, HomeMenu } from "./Menu";
import { Ticker } from "./Ticker";
import { Visit } from "./Visit";
import "./styles.css";

const ACCENT_RE = /^#[0-9a-f]{6}$/i;

/** Passive "this is a draft" note; the page renders the real Apply/Reject banner outside the template. */
function DraftNote({ summary_bg, summary_en }: { summary_bg: string; summary_en: string }) {
  const { lang, t } = useLang();
  return (
    <div role="status" className="kv-draft">
      <p className="kv-wrap kv-draft-inner">
        <span className="kv-draft-badge">{t("site.draft")}</span>
        <span>{lang === "bg" ? summary_bg : summary_en}</span>
      </p>
    </div>
  );
}

/**
 * The accent as text on the paper (OKLCH lightness capped at 0.5, then darkened if needed to >= 4.5:1 on #e9e8e3), as the
 * "Now" block fill under --kv-on text (capped at 0.53, then darkened if needed to >= 4.5:1 under #f6f5f1) and the change-flash
 * tint (14% on the paper, in OKLab). Computed here rather than with CSS relative colour syntax; test/template-kvartal.test.ts
 * sweeps the colour space against these floors.
 */
export function accentVars(accent: string) {
  return {
    "--kv-accent-text": ensureContrast(capAccent(accent, { maxL: 0.5 }), "#e9e8e3", 4.5, "darken"),
    "--kv-accent-fill": ensureContrast(capAccent(accent, { maxL: 0.53 }), "#f6f5f1", 4.5, "darken"),
    "--kv-accent-soft": mixHex(accent, "#e9e8e3", 0.14),
  };
}

/** Kvartal: Swiss 12-column grid, poster-sized headline, numbered menu tables; brunch by day, cocktails by night (Geologica + Fira Sans). */
export function Template({ state: initial, now: initialNow, slug, page, draft, live, feedUrl, preview = false }: TemplateProps) {
  const { state, changed } = useLiveSite(initial, feedUrl, live);
  const now = useNow(initialNow);
  const accent = ACCENT_RE.test(state.venue.theme.accent) ? state.venue.theme.accent : "#c23a1c";
  const media: MediaLookup = (id) => mediaUrl(id ? state.media.find((m) => m.id === id) : null, { preview });
  const { sections, numbers } = menuSections(state, now);
  const menuProps = { state, now, changed, media, slug, sections, numbers };
  return (
    <div className={`tpl-kvartal ${fontVars}`} style={{ "--accent": accent, ...accentVars(accent) } as CSSProperties} data-page={page}>
      {draft && <DraftNote summary_bg={draft.summary_bg} summary_en={draft.summary_en} />}
      <Header state={state} slug={slug} page={page} media={media} />
      <main id="main" className="kv-main">
        <Hero state={state} now={now} page={page} />
        <Ticker state={state} now={now} numbers={numbers} changed={changed} />
        {page === "home" ? (
          <>
            <HomeMenu {...menuProps} />
            <Gallery state={state} media={media} />
          </>
        ) : (
          <FullMenu {...menuProps} />
        )}
        <Visit state={state} now={now} />
      </main>
      <ActionBar state={state} slug={slug} page={page} />
      <Footer state={state} feedUrl={feedUrl} />
    </div>
  );
}
