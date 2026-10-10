"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children into a same-origin iframe document. The templates are built for a whole viewport (vw units, viewport
 * media queries, a position: fixed grain), so a half-width pane or a scaled card has to BE a viewport. The parent's
 * stylesheets, root font classes and base URL are mirrored into the frame; blob: URLs stay valid (same origin).
 */
export function FrameDoc({ title, lang, hidden = false, className = "", children }: { title: string; lang: string; hidden?: boolean; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<Document | null>(null);

  const init = useCallback((d: Document | null | undefined) => {
    if (!d || d.readyState !== "complete" || d.body.dataset.ready) return;
    d.body.dataset.ready = "1";
    const root = d.documentElement;
    root.lang = lang;
    root.className = document.documentElement.className;
    d.body.className = document.body.className;
    const base = d.createElement("base");
    base.href = document.baseURI;
    d.head.appendChild(base);
    const seen = new Set<string>();
    const pending: Promise<void>[] = [];
    const mirror = () => {
      for (const el of Array.from(document.head.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style'))) {
        const key = el instanceof HTMLLinkElement ? el.href : el.textContent ?? "";
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const clone = el.cloneNode(true) as HTMLLinkElement | HTMLStyleElement;
        if (clone instanceof HTMLLinkElement) pending.push(new Promise((done) => { clone.onload = () => done(); clone.onerror = () => done(); }));
        d.head.appendChild(clone);
      }
    };
    mirror();
    const mo = new MutationObserver(mirror); // dev HMR appends new stylesheet links; keep the frame in step
    mo.observe(document.head, { childList: true });
    const timeout = new Promise<void>((done) => window.setTimeout(done, 1500));
    void Promise.race([Promise.all(pending).then(() => undefined), timeout]).then(() => setDoc(d));
    return () => mo.disconnect();
  }, [lang]);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    return init(frame.contentDocument);
  }, [init]);

  return (
    <>
      <iframe ref={ref} title={title} onLoad={() => init(ref.current?.contentDocument)} tabIndex={hidden ? -1 : undefined} aria-hidden={hidden || undefined} className={`block size-full border-0 bg-transparent ${className}`} />
      {doc && createPortal(children, doc.body)}
    </>
  );
}
