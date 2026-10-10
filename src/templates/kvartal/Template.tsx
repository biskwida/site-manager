"use client";
import type { CSSProperties } from "react";
import { useLang } from "@/src/i18n";
import type { TemplateProps } from "../index";
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

/** Kvartal: Swiss 12-column grid, poster-sized headline, numbered menu tables; brunch by day, cocktails by night (Geologica + Fira Sans). */
export function Template({ state: initial, now: initialNow, slug, page, draft, live, feedUrl, preview = false }: TemplateProps) {
  const { state, changed } = useLiveSite(initial, feedUrl, live);
  const now = useNow(initialNow);
  const accent = ACCENT_RE.test(state.venue.theme.accent) ? state.venue.theme.accent : "#C23A1C";
  const media: MediaLookup = (id) => mediaUrl(id ? state.media.find((m) => m.id === id) : null, { preview });
  const { sections, numbers } = menuSections(state, now);
  const menuProps = { state, now, changed, media, slug, sections, numbers };
  return (
    <div className={`tpl-kvartal ${fontVars}`} style={{ "--accent": accent } as CSSProperties} data-page={page}>
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
