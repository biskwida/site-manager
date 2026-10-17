// Text card: venue name + tagline on the accent colour (cover photo behind it when there is one).
import { ImageResponse } from "next/og";
import { loadFeedOrNull } from "./feed";

export const dynamic = "force-dynamic";
export const alt = "Site";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Onest subset to the glyphs we print (Google serves this user agent WOFF; Satori reads TTF/OTF/WOFF, not WOFF2). Best effort: null after 3 s or any error. */
async function cyrillicFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=Onest:wght@600&text=${encodeURIComponent(text)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:27.0) Gecko/20100101 Firefox/27.0" },
      signal: AbortSignal.timeout(3000),
    }).then((r) => (r.ok ? r.text() : ""));
    const url = css.match(/src:\s*url\(([^)]+)\)\s*format\(['"](?:woff|truetype|opentype)['"]\)/)?.[1];
    if (!url) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok ? res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function Image() {
  const state = await loadFeedOrNull();
  const name = state?.venue.name ?? "Site";
  const tagline = state ? (state.venue.default_lang === "bg" ? state.venue.tagline_bg : state.venue.tagline_en) : "";
  const accent = state && /^#[0-9a-f]{6}$/i.test(state.venue.theme.accent) ? state.venue.theme.accent : "#2f6b4f";
  const cover = state?.media.find((m) => m.id === state.venue.cover_media_id)?.public_url ?? null;
  const coverUrl = cover && /^https:\/\/[^/]+\.supabase\.co\//.test(cover) ? cover : null;
  const font = await cyrillicFont(`${name} ${tagline}`);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: accent, color: "white", fontFamily: font ? "Onest" : "sans-serif" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders a plain <img>; next/image does not exist inside ImageResponse */}
        {coverUrl && <img src={coverUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.55 }} />}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 72, width: "100%", height: "100%", background: "linear-gradient(to top, rgba(0,0,0,0.65), rgba(0,0,0,0.15))" }}>
          <div style={{ fontSize: 72, fontWeight: 600, lineHeight: 1.1 }}>{name}</div>
          {tagline && <div style={{ marginTop: 20, fontSize: 34, opacity: 0.92 }}>{tagline}</div>}
        </div>
      </div>
    ),
    // No `fonts` key at all without Onest: an empty array switches off Satori's built-in default font and the card fails to render.
    { ...size, ...(font ? { fonts: [{ name: "Onest", data: font, weight: 600, style: "normal" as const }] } : {}) },
  );
}
