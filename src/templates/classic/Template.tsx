"use client";
import type { CSSProperties } from "react";
import type { TemplateProps } from "../index";
import { useLiveSite, useNow } from "../shared/useLiveSite";
import { AboutHours } from "./AboutHours";
import { fontVars } from "./fonts";
import { Gallery } from "./Gallery";
import { Highlights } from "./Highlights";
import { MenuList } from "./MenuList";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { Specials } from "./Specials";
import { TodayStatus } from "./TodayStatus";

/** Classic: warm editorial, cream paper (Literata + Onest). Markup and classes are the former app/[slug] SiteView. */
export function Template({ state: initial, now: initialNow, slug, page, live, feedUrl, preview = false }: TemplateProps) {
  const { state, changed } = useLiveSite(initial, feedUrl, live);
  const now = useNow(initialNow);
  const accent = /^#[0-9a-f]{6}$/i.test(state.venue.theme.accent) ? state.venue.theme.accent : "#2f6b4f";
  return (
    <div style={{ "--accent": accent, fontFamily: "var(--font-body)" } as CSSProperties} className={`${fontVars} flex flex-1 flex-col`}>
      <SiteHeader state={state} slug={slug} page={page} preview={preview} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-12 sm:px-6">
        <TodayStatus state={state} now={now} />
        {page === "home" ? (
          <>
            <Specials state={state} now={now} changed={changed} preview={preview} />
            <Highlights state={state} now={now} slug={slug} changed={changed} preview={preview} />
            <AboutHours state={state} now={now} />
            <Gallery state={state} preview={preview} />
          </>
        ) : (
          <MenuList state={state} now={now} changed={changed} preview={preview} />
        )}
      </main>
      <SiteFooter state={state} />
    </div>
  );
}
