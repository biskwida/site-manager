"use client";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FrameDoc } from "./FrameDoc";

/**
 * A 1280×1600 page scaled to the box width. The inside is inert: the card's button is the only control.
 * Before the ResizeObserver has measured (server HTML, first paint) CSS computes the same ratio from the container width,
 * so the card never shows at a wrong scale. No CSS `zoom` (inconsistent in Safari for position: fixed children).
 */
export function ScaledFrame({ width = 1280, height = 1600, title, lang, children, className = "" }: { width?: number; height?: number; title: string; lang: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  const transform = scale === null ? `scale(tan(atan2(100cqw, ${width}px)))` : `scale(${scale})`;
  return (
    <div ref={ref} className={`relative overflow-hidden ${className}`} style={{ aspectRatio: `${width} / ${height}`, containerType: "inline-size" } as CSSProperties}>
      <div inert aria-hidden="true" className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width, height, transform }}>
        <FrameDoc title={title} lang={lang} hidden>{children}</FrameDoc>
      </div>
    </div>
  );
}
