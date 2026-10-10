"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

function setDocLang(d: Document | null | undefined, lang: string) {
  if (d) d.documentElement.lang = lang;
}

/**
 * Renders children into a same-origin iframe document. The templates are built for a whole viewport (vw units, viewport
 * media queries, a position: fixed grain), so a half-width pane or a scaled card has to BE a viewport. The parent's
 * stylesheets, root font classes and base URL are mirrored into the frame; blob: URLs stay valid (same origin).
 * `onLinkClick` sees every link click inside the frame before React does (capture phase on the frame document), so a
 * template's next/link can never drive the wizard's router.
 */
export function FrameDoc({ title, lang, hidden = false, className = "", onLinkClick, children }: { title: string; lang: string; hidden?: boolean; className?: string; onLinkClick?: (a: HTMLAnchorElement, doc: Document) => void; children: ReactNode }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const mirrorRef = useRef<(() => void) | null>(null);
  const onLink = useRef(onLinkClick);
  useEffect(() => { onLink.current = onLinkClick; }, [onLinkClick]);

  function init(d: Document | null | undefined) {
    if (!d || d.readyState !== "complete" || d.body.dataset.ready) return;
    d.body.dataset.ready = "1";
    d.documentElement.className = document.documentElement.className;
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
    mirrorRef.current = mirror;
    d.addEventListener("click", (e) => {
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a) return;
      e.preventDefault();
      e.stopPropagation(); // before React's listener on the portal root: next/link never sees it
      onLink.current?.(a, d);
    }, true);
    const timeout = new Promise<void>((done) => window.setTimeout(done, 1500));
    void Promise.race([Promise.all(pending).then(() => undefined), timeout]).then(() => setDoc(d));
  }

  useEffect(() => init(ref.current?.contentDocument), []);

  // Dev HMR appends new stylesheet links to the parent: keep the frame in step. Disconnected on unmount.
  useEffect(() => {
    const mirror = mirrorRef.current;
    if (!doc || !mirror) return;
    const mo = new MutationObserver(mirror);
    mo.observe(document.head, { childList: true });
    return () => mo.disconnect();
  }, [doc]);

  // The frame's own <html lang> follows the language it shows (screen readers, hyphenation, quotes).
  useEffect(() => {
    if (doc) setDocLang(ref.current?.contentDocument, lang);
  }, [doc, lang]);

  return (
    <>
      <iframe ref={ref} title={title} onLoad={() => init(ref.current?.contentDocument)} tabIndex={hidden ? -1 : undefined} aria-hidden={hidden || undefined} className={`block size-full border-0 bg-transparent ${className}`} />
      {doc && createPortal(children, doc.body)}
    </>
  );
}
