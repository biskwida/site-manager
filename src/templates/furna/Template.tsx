"use client";
import type { CSSProperties } from "react";
import { useLang } from "@/src/i18n";
import type { TemplateProps } from "../index";
import { mediaUrl } from "../shared/media";
import { useLiveSite, useNow } from "../shared/useLiveSite";
import type { MediaLookup } from "./bits";
import { fontVars } from "./fonts";
import { Dock, Footer } from "./Footer";
import { Gallery } from "./Gallery";
import { Hero } from "./Hero";
import { Notice } from "./Notice";
import { Oven } from "./Oven";
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

/** Furna: a neighbourhood bakery and breakfast place; cream paper, shop-sign type, the dark oven panel (Yeseva One + Arsenal). */
export function Template({ state: initial, now: initialNow, slug, page, draft, live, feedUrl, preview = false }: TemplateProps) {
  const { state, changed } = useLiveSite(initial, feedUrl, live);
  const now = useNow(initialNow);
  const accent = ACCENT_RE.test(state.venue.theme.accent) ? state.venue.theme.accent : "#b8432a";
  const media: MediaLookup = (id) => mediaUrl(id ? state.media.find((m) => m.id === id) : null, { preview });
  return (
    <div className={`tpl-furna ${fontVars}`} style={{ "--accent": accent } as CSSProperties} data-page={page}>
      {draft && <DraftNote summary_bg={draft.summary_bg} summary_en={draft.summary_en} />}
      <Hero state={state} now={now} slug={slug} page={page} media={media} oven={<Oven state={state} now={now} changed={changed} media={media} page={page} />} />
      <main id="main" className="fu-main">
        <Notice state={state} now={now} />
        {page === "home" ? (
          <>
            <Window variant="highlights" state={state} now={now} changed={changed} media={media} slug={slug} />
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
