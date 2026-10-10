"use client";
import type { CSSProperties } from "react";
import { useLang } from "@/src/i18n";
import type { TemplateProps } from "../index";
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

/** Mehana: a traditional Bulgarian tavern. Wine band, embroidery border, the menu course by course (Brygada 1918 + Wix Madefor Text). */
export function Template({ state: initial, now: initialNow, slug, page, draft, live, feedUrl, preview = false }: TemplateProps) {
  const { state, changed } = useLiveSite(initial, feedUrl, live);
  const now = useNow(initialNow);
  const accent = ACCENT_RE.test(state.venue.theme.accent) ? state.venue.theme.accent : "#6E1F1B";
  const media: MediaLookup = (id) => mediaUrl(id ? state.media.find((m) => m.id === id) : null, { preview });
  return (
    <div className={`tpl-mehana ${fontVars}`} style={{ "--accent": accent } as CSSProperties} data-page={page}>
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
