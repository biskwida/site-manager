"use client";
import type { CSSProperties } from "react";
import { useLang } from "@/src/i18n";
import type { TemplateProps } from "../index";
import { capAccent, mixHex } from "../shared/color";
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

/** Lumen: light, photo-first, airy; for daytime specialty coffee (Playfair Display + Golos Text). */
export function Template({ state: initial, now: initialNow, slug, page, draft, live, feedUrl, preview = false }: TemplateProps) {
  const { state, changed } = useLiveSite(initial, feedUrl, live);
  const now = useNow(initialNow);
  const accent = ACCENT_RE.test(state.venue.theme.accent) ? state.venue.theme.accent : "#2e5e4e";
  // Accent as text and button fill (OKLCH lightness capped at 0.5, chroma at 0.14) and the soft tint (10% accent on the paper,
  // #f8fbf9), computed here rather than with CSS relative colour syntax: the text reads >= 4.9:1 on either paper and the ink
  // >= 11.9:1 on the tint for any accent (test/template-lumen.test.ts).
  const accentText = capAccent(accent, { maxL: 0.5, maxC: 0.14 });
  const accentSoft = mixHex(accent, "#f8fbf9", 0.1);
  const media: MediaLookup = (id) => mediaUrl(id ? state.media.find((m) => m.id === id) : null, { preview });
  return (
    <div className={`tpl-lumen ${fontVars}`} style={{ "--accent": accent, "--l-accent-text": accentText, "--l-accent-soft": accentSoft } as CSSProperties} data-page={page}>
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
