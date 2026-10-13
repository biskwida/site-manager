"use client";
import type { CSSProperties } from "react";
import { useLang } from "@/src/i18n";
import type { TemplateProps } from "../index";
import { capAccent, ensureContrast } from "../shared/color";
import { groundFor, onGround, type Ground } from "../shared/ground";
import { mediaUrl } from "../shared/media";
import { useLiveSite, useNow } from "../shared/useLiveSite";
import type { MediaLookup } from "./bits";
import { fontVars } from "./fonts";
import { Footer } from "./Footer";
import { Gallery } from "./Gallery";
import { Hero } from "./Hero";
import { MenuList } from "./MenuList";
import { Specials, Tonight } from "./Tonight";
import { Visit } from "./Visit";
import "./styles.css";

const ACCENT_RE = /^#[0-9a-f]{6}$/i;

/** Passive "this is a draft" note; the page renders the real Apply/Reject banner outside the template. */
function DraftNote({ summary_bg, summary_en }: { summary_bg: string; summary_en: string }) {
  const { lang, t } = useLang();
  return (
    <div role="status" className="n-draft">
      <p className="n-wrap n-draft-inner">
        <span className="n-draft-badge">{t("site.draft")}</span>
        <span>{lang === "bg" ? summary_bg : summary_en}</span>
      </p>
    </div>
  );
}

/**
 * The accent as text and button fill: OKLCH lightness lifted to >= 0.78 and chroma capped at 0.14, then lifted further if
 * needed until it reads >= 8.2:1 on --n-bg-2 (#1c1711, the lighter ground; --n-bg is darker still). Computed here rather than
 * with CSS relative colour syntax; test/template-nocturne.test.ts sweeps the colour space against these floors.
 */
export function accentVars(accent: string) {
  return { "--n-accent-text": ensureContrast(capAccent(accent, { minL: 0.78, maxC: 0.14 }), "#1c1711", 8.2, "lighten") };
}

/**
 * The owner's background (shared/ground.ts): both grounds, ink and soft ink from it; the accent as text moved until it reads
 * >= 4.5:1 on both grounds (darker on a light ground). Nothing without a background.
 */
export function groundVars(g: Ground | null, accent: string): Record<string, string> {
  if (!g) return {};
  return {
    "--n-bg": g.bg,
    "--n-bg-2": g.bg2,
    "--n-ink": g.ink,
    "--n-ink-soft": g.inkSoft,
    "--n-accent-text": onGround(accent, g, [g.bg, g.bg2]),
    colorScheme: g.dark ? "dark" : "light",
  };
}

/** Nocturne: dark, cinematic, for bars and evening venues (Unbounded + Manrope). */
export function Template({ state: initial, now: initialNow, slug, page, draft, live, feedUrl, preview = false }: TemplateProps) {
  const { state, changed } = useLiveSite(initial, feedUrl, live);
  const now = useNow(initialNow);
  const accent = ACCENT_RE.test(state.venue.theme.accent) ? state.venue.theme.accent : "#d9a05b";
  const media: MediaLookup = (id) => mediaUrl(id ? state.media.find((m) => m.id === id) : null, { preview });
  return (
    <div className={`tpl-nocturne ${fontVars}`} style={{ "--accent": accent, ...accentVars(accent), ...groundVars(groundFor(state.venue.theme.background), accent) } as CSSProperties} data-page={page}>
      <div aria-hidden="true" className="n-grain" />
      {draft && <DraftNote summary_bg={draft.summary_bg} summary_en={draft.summary_en} />}
      <Hero state={state} slug={slug} page={page} media={media} aside={<Tonight state={state} now={now} />} />
      <main id="main" className="n-wrap n-main">
        <Specials state={state} now={now} changed={changed} media={media} />
        {page === "home" ? (
          <>
            <MenuList variant="highlights" state={state} now={now} changed={changed} media={media} slug={slug} />
            <Visit state={state} now={now} />
            <Gallery state={state} media={media} />
          </>
        ) : (
          <MenuList variant="full" state={state} now={now} changed={changed} media={media} slug={slug} />
        )}
      </main>
      <Footer state={state} feedUrl={feedUrl} />
    </div>
  );
}
