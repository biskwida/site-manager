"use client";
import Image from "next/image";
import type { SiteState } from "@/src/domain/types";
import { findMedia, mediaUrl as sharedMediaUrl } from "../shared/media";

export type { Changed } from "../shared/types";

/** The media's public URL when next/image may load it (https on a Supabase host, as in next.config remotePatterns); otherwise null. */
export function mediaUrl(state: SiteState, id: string | null): string | null {
  return sharedMediaUrl(findMedia(state.media, id));
}

/** A cover-cropped image filling its box, or a neutral tile. Put it inside a sized box. */
export function SiteImage({ src, alt, sizes, priority = false }: { src: string | null; alt: string; sizes: string; priority?: boolean }) {
  if (!src) return <div aria-hidden="true" className="absolute inset-0 bg-paper-deep" />;
  return <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" />;
}

/** Brief highlight behind a card's content when it just changed; keyed by the change time so it re-triggers. Needs an `isolate` parent. */
export function Flash({ at }: { at: number | undefined }) {
  if (at === undefined) return null;
  return <span key={at} aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 animate-flash rounded-[inherit] bg-amber-soft ring-2 ring-amber/40" />;
}
