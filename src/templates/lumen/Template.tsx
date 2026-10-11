"use client";
import type { CSSProperties } from "react";
import { useLang } from "@/src/i18n";
import type { TemplateProps } from "../index";
import { capAccent, ensureContrast, mixHex } from "../shared/color";
import { mediaUrl } from "../shared/media";
import { useLiveSite, useNow } from "../shared/useLiveSite";
import type { MediaLookup } from "./bits";
import { fontVars } from "./fonts";
import { Footer } from "./Footer";
import { Gallery } from "./Gallery";
import { Hero } from "./Hero";
import { MenuList } from "./MenuList";
import { Today } from "./Today";
import { Visit } from "./Visit";
import "./styles.css";

const ACCENT_RE = /^#[0-9a-f]{6}$/i;

/** Passive "this is a draft" note; the page renders the real Apply/Reject banner outside the template. */
function DraftNote({ summary_bg, summary_en }: { summary_bg: string; summary_en: string }) {
  const { lang, t } = useLang();
  return (
    <div role="status" className="l-draft">
      <p className="l-wrap l-draft-inner">
        <span className="l-draft-badge">{t("site.draft")}</span>
        <span>{lang === "bg" ? summary_bg : summary_en}</span>
      </p>
    </div>
  );
}

/**
 * The accent as text and button fill (OKLCH lightness capped at 0.5, chroma at 0.14, then darkened if needed until it reads
 * >= 4.9:1 on --l-bg-2, #edf2ed, and so more on --l-bg) and the soft tint (10% accent on the paper, #f8fbf9, in OKLab).
 * Computed here rather than with CSS relative colour syntax; test/template-lumen.test.ts sweeps the colour space.
 */
export function accentVars(accent: string) {
  return {
    "--l-accent-text": ensureContrast(capAccent(accent, { maxL: 0.5, maxC: 0.14 }), "#edf2ed", 4.9, "darken"),
    "--l-accent-soft": mixHex(accent, "#f8fbf9", 0.1),
  };
}

/** Lumen: light, photo-first, airy; for daytime specialty coffee (Playfair Display + Golos Text). */
export function Template({ state: initial, now: initialNow, slug, page, draft, live, feedUrl, preview = false }: TemplateProps) {
  const { state, changed } = useLiveSite(initial, feedUrl, live);
  const now = useNow(initialNow);
  const accent = ACCENT_RE.test(state.venue.theme.accent) ? state.venue.theme.accent : "#2e5e4e";
  const media: MediaLookup = (id) => mediaUrl(id ? state.media.find((m) => m.id === id) : null, { preview });
  return (
    <div className={`tpl-lumen ${fontVars}`} style={{ "--accent": accent, ...accentVars(accent) } as CSSProperties} data-page={page}>
      {draft && <DraftNote summary_bg={draft.summary_bg} summary_en={draft.summary_en} />}
      <Hero state={state} slug={slug} page={page} media={media} />
      <main id="main" className="l-wrap l-main">
        <Today state={state} now={now} changed={changed} media={media} />
        {page === "home" ? (
          <>
            <Gallery state={state} media={media} />
            <MenuList variant="highlights" state={state} now={now} changed={changed} media={media} slug={slug} />
            <Visit state={state} now={now} />
          </>
        ) : (
          <MenuList variant="full" state={state} now={now} changed={changed} media={media} slug={slug} />
        )}
      </main>
      <Footer state={state} feedUrl={feedUrl} />
    </div>
  );
}
