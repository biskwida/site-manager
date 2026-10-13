"use client";
import type { CSSProperties } from "react";
import { useLang } from "@/src/i18n";
import type { TemplateProps } from "../index";
import { capAccent, ensureContrast, mixHex } from "../shared/color";
import { groundFor, onGround, type Ground } from "../shared/ground";
import { mediaUrl } from "../shared/media";
import { useLiveSite, useNow } from "../shared/useLiveSite";
import type { MediaLookup } from "./bits";
import { fontVars } from "./fonts";
import { Dock, Footer } from "./Footer";
import { Gallery } from "./Gallery";
import { Hero } from "./Hero";
import { Notice } from "./Notice";
import { Oven, ovenPicks, ovenSpecials } from "./Oven";
import { Visit } from "./Visit";
import { Window } from "./Window";
import "./styles.css";

const ACCENT_RE = /^#[0-9a-f]{6}$/i;

/** Passive "this is a draft" note; the page renders the real Apply/Reject banner outside the template. */
function DraftNote({ summary_bg, summary_en }: { summary_bg: string; summary_en: string }) {
  const { lang, t } = useLang();
  return (
    <div role="status" className="fu-draft">
      <p className="fu-wrap fu-draft-inner">
        <span className="fu-draft-badge">{t("site.draft")}</span>
        <span>{lang === "bg" ? summary_bg : summary_en}</span>
      </p>
    </div>
  );
}

/**
 * The accent as display text, link hover colour and button fill: OKLCH lightness capped at 0.542 (tomato's own), chroma at
 * 0.17, then darkened if needed until it reads >= 4.5:1 on the paper (#f6eedb); the button text (#fff8ea) is lighter than the
 * paper, so it reads at least as well on the fill. Computed here rather than with CSS relative colour syntax;
 * test/template-furna.test.ts sweeps the colour space against these floors.
 */
export function accentVars(accent: string) {
  return { "--fu-accent-text": ensureContrast(capAccent(accent, { maxL: 0.542, maxC: 0.17 }), "#f6eedb", 4.5, "darken") };
}

/**
 * The owner's background (shared/ground.ts): paper, day tiles, the notice strip (a hint of butter in the ground), ink and the
 * softer text tones, rules and the open/later/closed words from the ground. Dark buttons keep their inversion (ground-coloured
 * text on ink), the accent button's text is the ground colour, and the accent as text reads >= 4.5:1 on the paper and the
 * strip. The oven panel keeps its own colours. Nothing without a background.
 */
export function groundVars(g: Ground | null, accent: string): Record<string, string> {
  if (!g) return {};
  const butter = mixHex("#ebd9a8", g.bg, g.dark ? 0.12 : 0.5);
  const soft = onGround(g.inkSoft, g, [g.bg, g.bg2, butter]);
  return {
    "--fu-bg": g.bg,
    "--fu-tile": g.bg2,
    "--fu-butter": butter,
    "--fu-ink": g.ink,
    "--fu-ink-2": onGround(mixHex(g.ink, soft, 0.5), g, [g.bg]),
    "--fu-soft": soft,
    "--fu-fine": soft,
    "--fu-line": g.line,
    "--fu-line-strong": mixHex(g.ink, g.bg, 0.3),
    "--fu-open": onGround("#2f6b3f", g, [g.bg, g.bg2]),
    "--fu-later": onGround("#8a5a2b", g, [g.bg, g.bg2]),
    "--fu-closed": onGround("#9e3a24", g, [g.bg, g.bg2]),
    "--fu-on-accent": g.bg,
    "--fu-accent-text": onGround(accent, g, [g.bg, butter]),
    colorScheme: g.dark ? "dark" : "light",
  };
}

/** Furna: a neighbourhood bakery and breakfast place; cream paper, shop-sign type, the dark oven panel (Yeseva One + Arsenal). */
export function Template({ state: initial, now: initialNow, slug, page, draft, live, feedUrl, preview = false }: TemplateProps) {
  const { state, changed } = useLiveSite(initial, feedUrl, live);
  const now = useNow(initialNow);
  const accent = ACCENT_RE.test(state.venue.theme.accent) ? state.venue.theme.accent : "#b8432a";
  const media: MediaLookup = (id) => mediaUrl(id ? state.media.find((m) => m.id === id) : null, { preview });
  const specials = ovenSpecials(state, now);
  // No specials: the home page's oven panel shows a few picks, and the window below leaves those out (no item twice).
  const picks = specials.length === 0 && page === "home" ? ovenPicks(state, now, media) : [];
  const inOven = new Set(picks.map((i) => i.id));
  return (
    <div className={`tpl-furna ${fontVars}`} style={{ "--accent": accent, ...accentVars(accent), ...groundVars(groundFor(state.venue.theme.background), accent) } as CSSProperties} data-page={page}>
      {draft && <DraftNote summary_bg={draft.summary_bg} summary_en={draft.summary_en} />}
      <Hero state={state} now={now} slug={slug} page={page} media={media} oven={<Oven state={state} now={now} changed={changed} specials={specials} picks={picks} />} />
      <main id="main" className="fu-main">
        <Notice state={state} now={now} />
        {page === "home" ? (
          <>
            <Window variant="highlights" state={state} now={now} changed={changed} media={media} slug={slug} exclude={inOven} />
            <Visit state={state} now={now} />
            <Gallery state={state} media={media} />
          </>
        ) : (
          <Window variant="full" state={state} now={now} changed={changed} media={media} slug={slug} />
        )}
      </main>
      <Footer state={state} feedUrl={feedUrl} />
      <Dock state={state} slug={slug} page={page} preview={preview} />
    </div>
  );
}
