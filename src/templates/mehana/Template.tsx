"use client";
import type { CSSProperties } from "react";
import { useLang } from "@/src/i18n";
import type { TemplateProps } from "../index";
import { capAccent, ensureContrast } from "../shared/color";
import { mediaUrl } from "../shared/media";
import { useLiveSite, useNow } from "../shared/useLiveSite";
import { Band } from "./Band";
import { Shevitsa, type MediaLookup } from "./bits";
import { fontVars } from "./fonts";
import { ActionBar, Footer } from "./Footer";
import { Gallery } from "./Gallery";
import { MenuList } from "./MenuList";
import { Tonight } from "./Tonight";
import { Visit } from "./Visit";
import "./styles.css";

const ACCENT_RE = /^#[0-9a-f]{6}$/i;

/** Passive "this is a draft" note; the page renders the real Apply/Reject banner outside the template. */
function DraftNote({ summary_bg, summary_en }: { summary_bg: string; summary_en: string }) {
  const { lang, t } = useLang();
  return (
    <div role="status" className="me-draft">
      <p className="me-wrap me-draft-inner">
        <span className="me-draft-badge">{t("site.draft")}</span>
        <span>{lang === "bg" ? summary_bg : summary_en}</span>
      </p>
    </div>
  );
}

/**
 * The band: the accent with OKLCH lightness capped at 0.42 and chroma at 0.13, then darkened if needed until the open dot
 * (#9bd39b) reads >= 4.6:1 and the gold link (#e8c98b) >= 4.9:1 on it; parchment then stays >= 6.5:1 by construction (>= 6.6:1 observed). Computed here rather
 * than with CSS relative colour syntax; test/template-mehana.test.ts sweeps the colour space against these floors.
 */
export function accentVars(accent: string) {
  const capped = capAccent(accent, { maxL: 0.42, maxC: 0.13 });
  return { "--me-wine": ensureContrast(ensureContrast(capped, "#9bd39b", 4.6, "darken"), "#e8c98b", 4.9, "darken") };
}

/** Mehana: a traditional Bulgarian tavern. Wine band, embroidery border, the menu course by course (Brygada 1918 + Wix Madefor Text). */
export function Template({ state: initial, now: initialNow, slug, page, draft, live, feedUrl, preview = false }: TemplateProps) {
  const { state, changed } = useLiveSite(initial, feedUrl, live);
  const now = useNow(initialNow);
  const accent = ACCENT_RE.test(state.venue.theme.accent) ? state.venue.theme.accent : "#6e1f1b";
  const media: MediaLookup = (id) => mediaUrl(id ? state.media.find((m) => m.id === id) : null, { preview });
  return (
    <div className={`tpl-mehana ${fontVars}`} style={{ "--accent": accent, ...accentVars(accent) } as CSSProperties} data-page={page}>
      {draft && <DraftNote summary_bg={draft.summary_bg} summary_en={draft.summary_en} />}
      <Band state={state} slug={slug} page={page} now={now} media={media} />
      <Shevitsa />
      <main id="main" className="me-main">
        <Tonight state={state} now={now} changed={changed} media={media} />
        {page === "home" ? (
          <>
            <MenuList variant="home" state={state} now={now} changed={changed} media={media} slug={slug} />
            <Gallery state={state} media={media} />
          </>
        ) : (
          <MenuList variant="full" state={state} now={now} changed={changed} media={media} slug={slug} />
        )}
      </main>
      {page === "home" && <Visit state={state} now={now} />}
      <Footer state={state} feedUrl={feedUrl} />
      <ActionBar state={state} slug={slug} page={page} />
    </div>
  );
}
