// src/visual/template.tsx
// The Instagram picture as a pure layout (rendered by next/og, i.e. satori: flexbox only, every multi-child box is flex).
// A cut-out dish on a coloured backdrop, the venue's mark at the top, the name, the price pill and an optional line below.
// When the cut-out failed, the original photo sits in a rounded card instead.
/* eslint-disable @next/next/no-img-element -- satori renders plain <img>; next/image does not apply here */
import type { Colours } from "./palette";

export type Format = "post" | "story";
export const SIZE: Record<Format, { width: number; height: number }> = {
  post: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};

export interface PictureProps {
  format: Format;
  /** data: URL of the cut-out PNG (transparent background) or of the original photo when `kind` is "photo". */
  image: string;
  kind: "cutout" | "photo";
  venueName: string;
  /** data: or https URL of the venue's logo, shown before the name when present. */
  logo?: string | null;
  dish: string;
  price?: string | null;
  line?: string | null;
  colours: Colours;
}

export function Picture(p: PictureProps) {
  const { width, height } = SIZE[p.format];
  // The story is 570 px taller: everything moves down so the dish sits in the middle of the screen.
  const y = p.format === "story" ? 285 : 0;
  const c = p.colours;
  const longName = p.dish.length > 18;
  return (
    <div style={{ width, height, display: "flex", position: "relative", background: c.bg, fontFamily: "Golos, GolosCyr", color: c.ink }}>
      {/* soft shape of a deeper tone behind the dish */}
      <div style={{ position: "absolute", left: 90, top: 250 + y, width: 900, height: 760, borderRadius: 400, background: c.deep }} />
      {/* venue mark */}
      <div style={{ position: "absolute", top: 84 + y * 0.5, left: 0, width, display: "flex", justifyContent: "center", alignItems: "center" }}>
        {p.logo ? <img alt="" src={p.logo} width={64} height={64} style={{ borderRadius: 32, marginRight: 22, objectFit: "cover" }} /> : null}
        <div style={{ fontFamily: "Prata, PrataCyr", fontSize: 46, letterSpacing: 4, display: "flex" }}>{p.venueName.toUpperCase()}</div>
      </div>
      {/* the dish */}
      {p.kind === "cutout" ? (
        <div style={{ position: "absolute", left: 120, top: 230 + y, width: 840, height: 840, display: "flex", alignItems: "center", justifyContent: "center", transform: "rotate(-5deg)" }}>
          {/* contact shadow: stacked faint ellipses stand in for a blur (the renderer has none) */}
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ position: "absolute", left: 180 - i * 28, right: 180 - i * 28, bottom: 52 - i * 8, height: 44 + i * 16, borderRadius: 999, background: "rgba(40,25,15,0.07)" }} />
          ))}
          <img alt="" src={p.image} width={840} height={840} style={{ objectFit: "contain" }} />
        </div>
      ) : (
        <div style={{ position: "absolute", left: 150, top: 250 + y, width: 780, height: 780, display: "flex", borderRadius: 48, overflow: "hidden", boxShadow: "0 40px 80px rgba(40,25,15,0.3)" }}>
          <img alt="" src={p.image} width={780} height={780} style={{ objectFit: "cover" }} />
        </div>
      )}
      {/* name, price, line */}
      <div style={{ position: "absolute", left: 90, right: 90, top: 1050 + y, display: "flex", flexDirection: "column" }}>
        <div style={{ fontFamily: "Prata, PrataCyr", fontSize: longName ? 84 : 108, lineHeight: 1.02, display: "flex" }}>{p.dish}</div>
        {p.price || p.line ? (
          <div style={{ display: "flex", alignItems: "center", marginTop: 26 }}>
            {p.price ? (
              <div style={{ display: "flex", background: c.pill, color: c.pillInk, fontWeight: 700, fontSize: 58, padding: "10px 32px", borderRadius: 999, marginRight: 26 }}>{p.price}</div>
            ) : null}
            {p.line ? <div style={{ display: "flex", fontSize: 40, fontWeight: 600, opacity: 0.85 }}>{p.line}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
