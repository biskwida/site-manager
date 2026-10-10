"use client";
import type { CSSProperties } from "react";
import type { SiteState } from "@/src/domain/types";
import type { DraftInfo } from "@/src/server/site";
import { AboutHours } from "./AboutHours";
import { DraftBanner } from "./DraftBanner";
import { Gallery } from "./Gallery";
import { Highlights } from "./Highlights";
import { MenuList } from "./MenuList";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { Specials } from "./Specials";
import { TodayStatus } from "./TodayStatus";
import { useLiveSite } from "./useLiveSite";

export function SiteView({ state: initial, slug, page, draft, live }: { state: SiteState; slug: string; page: "home" | "menu"; draft: DraftInfo | null; live: boolean }) {
  const { state, now, changed } = useLiveSite(initial, slug, live);
  const accent = /^#[0-9a-f]{6}$/i.test(state.venue.theme.accent) ? state.venue.theme.accent : "#2f6b4f";
  return (
    <div style={{ "--accent": accent } as CSSProperties} className="flex flex-1 flex-col">
      {draft && <DraftBanner draft={draft} slug={slug} />}
      <SiteHeader state={state} slug={slug} page={page} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-12 sm:px-6">
        <TodayStatus state={state} now={now} />
        {page === "home" ? (
          <>
            <Specials state={state} now={now} changed={changed} />
            <Highlights state={state} now={now} slug={slug} changed={changed} />
            <AboutHours state={state} now={now} />
            <Gallery state={state} />
          </>
        ) : (
          <MenuList state={state} now={now} changed={changed} />
        )}
      </main>
      <SiteFooter state={state} />
    </div>
  );
}
