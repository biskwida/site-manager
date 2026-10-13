"use client";
import type { CSSProperties } from "react";
import type { TemplateProps } from "../index";
import { mixHex } from "../shared/color";
import { groundFor, onGround, type Ground } from "../shared/ground";
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

/**
 * The owner's background as Classic's Tailwind tokens (they are plain custom properties, so the inline values win for the
 * whole tree): paper, the deeper paper, cards, ink, soft ink, and the amber/clay status pairs moved until their text reads
 * >= 4.5:1 on their tint and on cards. `--accent-ground` is what the accent's soft tint mixes into (white by default; see
 * app/globals.css). Nothing for no background, so the design renders exactly as before.
 */
export function groundVars(g: Ground | null): Record<string, string> {
  if (!g) return {};
  const amberSoft = mixHex("#8f5c10", g.surface, 0.16);
  const claySoft = mixHex("#a4442c", g.bg, 0.16);
  return {
    "--color-paper": g.bg,
    "--color-paper-deep": g.bg2,
    "--color-card": g.surface,
    "--color-ink": g.ink,
    "--color-ink-soft": g.inkSoft,
    "--color-amber": onGround("#8f5c10", g, [amberSoft, g.surface]),
    "--color-amber-soft": amberSoft,
    "--color-clay": onGround("#a4442c", g, [claySoft, g.surface, g.bg]),
    "--color-clay-soft": claySoft,
    "--accent-ground": g.bg,
    background: g.bg,
    color: g.ink,
    colorScheme: g.dark ? "dark" : "light",
  };
}

/** Classic: warm editorial, cream paper (Literata + Onest). Markup and classes are the former app/[slug] SiteView. */
export function Template({ state: initial, now: initialNow, slug, page, live, feedUrl, preview = false }: TemplateProps) {
  const { state, changed } = useLiveSite(initial, feedUrl, live);
  const now = useNow(initialNow);
  const accent = /^#[0-9a-f]{6}$/i.test(state.venue.theme.accent) ? state.venue.theme.accent : "#2f6b4f";
  const ground = groundFor(state.venue.theme.background);
  return (
    <div style={{ "--accent": accent, fontFamily: "var(--font-body)", ...groundVars(ground) } as CSSProperties} className={`${fontVars} flex flex-1 flex-col`}>
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
