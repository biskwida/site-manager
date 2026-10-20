"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, SpeakerHigh, Trophy, Storefront, Check } from "@phosphor-icons/react";
import { siTelegram, siMessenger, siWhatsapp, siInstagram } from "simple-icons";
import { startPath } from "@/src/auth/start-links";
import { copy, COFFIQUE_URL, TELEGRAM_URL, trialLine, type Copy, type Lang } from "@/src/landing/copy";
import { LANG_STORAGE_KEY, persistLang, resolveClientLang } from "@/src/landing/lang";

const EASE = [0.23, 1, 0.32, 1] as const;

/** localStorage, or null when the browser blocks it (reading the property itself can throw). */
function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface LandingProps {
  /** The language the server chose (?lang=, the claudia-lang cookie, Accept-Language, English). The visitor's saved choice can still replace it after hydration. */
  initialLang: Lang;
  /** A signed-in visitor sees "Dashboard" instead of "Log in". */
  signedIn: boolean;
  /** NEXT_PUBLIC_CONTACT_EMAIL; null hides the "Talk to us" line. */
  contactEmail: string | null;
  /** TRIAL_REQUIRES_CARD: "no card" is part of the trial line only when no card is asked for. */
  requiresCard: boolean;
}

export function Landing({ initialLang, signedIn, contactEmail, requiresCard }: LandingProps) {
  const [lang, setLang] = useState<Lang>(initialLang);
  useEffect(() => {
    // Read once on mount: the server cannot see localStorage.
    try {
      const next = resolveClientLang({ search: window.location.search, stored: localStorage.getItem(LANG_STORAGE_KEY), initial: initialLang });
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLang(next);
    } catch {
      /* no storage: keep the server's language */
    }
  }, [initialLang]);
  useEffect(() => {
    document.documentElement.lang = lang;
    persistLang(lang, { storage: safeStorage(), setCookie: (c) => void (document.cookie = c), secure: location.protocol === "https:" });
  }, [lang]);
  const t = copy[lang];
  return (
    // `lang` here (not only on <html>) so the server's HTML already announces the right language before hydration.
    <div lang={lang} className="contents">
      <Nav t={t} lang={lang} signedIn={signedIn} onToggle={() => setLang(lang === "en" ? "bg" : "en")} />
      <main>
        <Hero t={t} lang={lang} requiresCard={requiresCard} />
        <Proof t={t} />
        <Steps t={t} />
        <Channels t={t} />
        <Trust t={t} />
        <Pricing t={t} lang={lang} />
        <Closing t={t} lang={lang} contactEmail={contactEmail} requiresCard={requiresCard} />
      </main>
      <Footer t={t} />
    </div>
  );
}

const Container = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`mx-auto w-full max-w-[1240px] px-5 sm:px-8 ${className}`}>{children}</div>
);

/** Fade-up on first view; static under reduced motion. */
function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.6, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

function Nav({ t, lang, signedIn, onToggle }: { t: Copy; lang: Lang; signedIn: boolean; onToggle: () => void }) {
  return (
    <header className="lp-nav-glass sticky top-0 z-20 border-b border-lp-line">
      <Container className="flex h-16 items-center justify-between gap-4">
        <a href="#top" className="lp-display text-[28px] leading-none">
          Claudia
        </a>
        <nav className="hidden items-center gap-7 text-[15px] font-medium text-lp-ink-2 md:flex">
          <a href="#how" className="transition-colors hover:text-lp-ink">{t.nav.how}</a>
          <a href="#pricing" className="transition-colors hover:text-lp-ink">{t.nav.pricing}</a>
        </nav>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onToggle} aria-label={t.nav.langLabel} className="lp-btn lp-btn-ghost min-h-10 px-3.5 text-sm">
            {t.nav.lang}
          </button>
          {signedIn ? (
            <Link href="/dashboard" className="lp-btn lp-btn-ghost min-h-10 px-3.5 text-sm">
              {t.nav.dashboard}
            </Link>
          ) : (
            <Link href="/login" className="lp-btn lp-btn-ghost min-h-10 px-3.5 text-sm">
              {t.nav.login}
            </Link>
          )}
          {/* Phones: the hero's own button is on screen right below, and the bar has no room for a third pill. */}
          <span className="hidden sm:contents">
            <Link href={startPath("/start", { lang })} className="lp-btn lp-btn-primary min-h-10 px-4 text-sm">
              {t.nav.start}
            </Link>
          </span>
        </div>
      </Container>
    </header>
  );
}

function Hero({ t, lang, requiresCard }: { t: Copy; lang: Lang; requiresCard: boolean }) {
  const reduce = useReducedMotion();
  const rise = (i: number) => (reduce ? {} : { initial: { opacity: 0, y: 22 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.7, delay: 0.08 * i, ease: EASE } });
  return (
    <section id="top" className="pt-10 pb-14 sm:pt-16 md:pt-20 md:pb-20">
      <Container>
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-12">
          <div>
            <motion.h1 {...rise(0)} className="lp-display text-balance text-[46px] sm:text-[60px] lg:text-[62px] xl:text-[70px]">
              {t.hero.h1}
            </motion.h1>
            <motion.p {...rise(1)} className="mt-6 max-w-[42ch] text-lg leading-relaxed text-lp-ink-2 sm:text-xl">
              {t.hero.sub}
            </motion.p>
            <motion.div {...rise(2)} className="mt-8 flex flex-wrap gap-3">
              <Link href={startPath("/start", { lang })} className="lp-btn lp-btn-primary">
                {t.nav.start}
                <ArrowRight size={18} weight="bold" />
              </Link>
              <a href="#demo" className="lp-btn lp-btn-ghost">
                {t.hero.demo}
              </a>
            </motion.div>
            <motion.p {...rise(3)} className="mt-4 text-[15px] font-medium text-lp-ink-2">
              {trialLine(t, requiresCard)}
            </motion.p>
          </div>
          <motion.div {...rise(1)}>
            <Demo t={t} lang={lang} />
          </motion.div>
        </div>
      </Container>
    </section>
  );
}

/** The real product video. Starts muted and looping; one tap plays it from the start with sound. */
function Demo({ t, lang }: { t: Copy; lang: Lang }) {
  const ref = useRef<HTMLVideoElement>(null);
  const reduce = useReducedMotion();
  const [sound, setSound] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v || reduce) return;
    v.muted = true;
    v.play().catch(() => undefined);
  }, [reduce]);
  const playWithSound = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = false;
    v.loop = false;
    v.currentTime = 0;
    v.controls = true;
    setSound(true);
    v.play().catch(() => undefined);
  };
  return (
    <div id="demo" className="relative overflow-hidden rounded-[var(--radius-media)] bg-lp-bg-2 lp-media-shadow">
      <video
        key={lang}
        ref={ref}
        className="block aspect-video w-full"
        src={lang === "bg" ? "/landing/claudia-demo-bg.mp4" : "/landing/claudia-demo.mp4"}
        poster={lang === "bg" ? "/landing/poster-bg.jpg" : "/landing/poster.jpg"}
        playsInline
        loop
        muted
        preload="metadata"
        onEnded={() => setSound(false)}
      />
      {!sound ? (
        <button
          type="button"
          onClick={playWithSound}
          className="lp-btn lp-btn-primary absolute bottom-4 left-4 min-h-11 px-4 text-sm"
        >
          <SpeakerHigh size={18} weight="bold" />
          {t.hero.watch}
        </button>
      ) : null}
    </div>
  );
}

function Proof({ t }: { t: Copy }) {
  return (
    <section className="border-y border-lp-line bg-lp-bg-2">
      <Container className="flex flex-col gap-3 py-5 text-[15px] font-medium text-lp-ink-2 sm:flex-row sm:items-center sm:justify-center sm:gap-10">
        <span className="inline-flex items-center gap-2">
          <Trophy size={20} weight="duotone" className="text-lp-accent" />
          {t.proof.award}
        </span>
        <a href={COFFIQUE_URL} className="inline-flex items-center gap-2 transition-colors hover:text-lp-ink">
          <Storefront size={20} weight="duotone" className="text-lp-accent" />
          {t.proof.live}
          <ArrowRight size={14} />
        </a>
      </Container>
    </section>
  );
}

function Steps({ t }: { t: Copy }) {
  return (
    <section id="how" className="py-20 md:py-28">
      <Container>
        <Reveal>
          <h2 className="lp-display max-w-[16ch] text-[40px] sm:text-[52px] md:text-[60px]">{t.steps.h}</h2>
        </Reveal>
        <ol className="mt-12 grid gap-10 border-t border-lp-line pt-10 md:grid-cols-3 md:gap-8">
          {t.steps.items.map((s, i) => (
            <Reveal key={s.t} delay={i * 0.08}>
              <li className="flex gap-5 md:block">
                <span className="lp-display shrink-0 text-[56px] leading-none text-lp-accent md:text-[72px]">{i + 1}</span>
                <div className="md:mt-4">
                  <h3 className="text-2xl font-semibold">{s.t}</h3>
                  <p className="mt-2 max-w-[38ch] text-[17px] leading-relaxed text-lp-ink-2">{s.d}</p>
                </div>
              </li>
            </Reveal>
          ))}
        </ol>
        {/* Real frames from the product demo, not mock-ups. */}
        <div className="mt-16 grid gap-5 md:grid-cols-12">
          <Reveal className="md:col-span-7">
            <figure>
              <Image src="/landing/frame-380.jpg" alt="" width={1600} height={900} sizes="(min-width: 768px) 700px, 100vw" className="w-full rounded-[var(--radius-media)] lp-media-shadow" />
              <figcaption className="mt-3 text-sm text-lp-ink-3">{t.steps.captions[0]}</figcaption>
            </figure>
          </Reveal>
          <Reveal className="md:col-span-5" delay={0.08}>
            <figure>
              <Image src="/landing/frame-1340.jpg" alt="" width={1600} height={900} sizes="(min-width: 768px) 500px, 100vw" className="w-full rounded-[var(--radius-media)] lp-media-shadow" />
              <figcaption className="mt-3 text-sm text-lp-ink-3">{t.steps.captions[1]}</figcaption>
            </figure>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

const Brand = ({ icon, size = 44 }: { icon: { path: string; hex: string; title: string }; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={icon.title}>
    <path d={icon.path} fill={`#${icon.hex}`} />
  </svg>
);

function Channels({ t }: { t: Copy }) {
  const apps = [siTelegram, siMessenger, siWhatsapp];
  return (
    <section className="py-16 md:py-20">
      <Container className="text-center">
        <Reveal>
          <h2 className="lp-display mx-auto max-w-[18ch] text-balance text-[36px] sm:text-[48px]">{t.channels.h}</h2>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="mt-10 flex items-center justify-center gap-8 sm:gap-12">
            {apps.map((a) => (
              <Brand key={a.title} icon={a} size={52} />
            ))}
            <span className="h-10 w-px bg-lp-line" aria-hidden />
            <Brand icon={siInstagram} size={52} />
          </div>
        </Reveal>
        <Reveal delay={0.14}>
          <p className="mx-auto mt-8 max-w-[52ch] text-lg leading-relaxed text-lp-ink-2">{t.channels.sub}</p>
        </Reveal>
      </Container>
    </section>
  );
}

function Trust({ t }: { t: Copy }) {
  return (
    <section className="bg-lp-accent-soft py-20 md:py-24">
      <Container>
        <Reveal>
          <h2 className="lp-display text-[40px] sm:text-[52px] md:text-[60px]">{t.trust.h}</h2>
        </Reveal>
        <dl className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1.4fr] lg:gap-12">
          {t.trust.items.map((it, i) => (
            <Reveal key={it.t} delay={i * 0.08}>
              <dt className="flex items-center gap-2 text-xl font-semibold">
                <Check size={20} weight="bold" className="text-lp-accent" />
                {it.t}
              </dt>
              <dd className="mt-2 max-w-[40ch] text-[17px] leading-relaxed text-lp-ink-2">{it.d}</dd>
            </Reveal>
          ))}
        </dl>
      </Container>
    </section>
  );
}

function Pricing({ t, lang }: { t: Copy; lang: Lang }) {
  return (
    <section id="pricing" className="py-20 md:py-28">
      <Container>
        <Reveal>
          <h2 className="lp-display max-w-[18ch] text-[40px] sm:text-[52px] md:text-[60px]">{t.pricing.h}</h2>
        </Reveal>
        <Reveal delay={0.06}>
          <div className="mt-12 flex flex-col gap-6 border-t border-lp-line pt-8 md:flex-row md:items-end md:justify-between">
            <div>
              <h3 className="text-2xl font-semibold">{t.pricing.setup.t}</h3>
              <p className="mt-1 max-w-[48ch] text-[17px] text-lp-ink-2">{t.pricing.setup.d}</p>
              <p className="mt-2 max-w-[48ch] text-[15px] text-lp-ink-3">{t.pricing.keep}</p>
            </div>
            <p className="shrink-0">
              <span className="lp-display text-[56px] leading-none">{t.pricing.setup.price}</span>
              <span className="ml-2 text-lp-ink-2">{t.pricing.setup.unit}</span>
            </p>
          </div>
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {t.pricing.plans.map((p, i) => (
            <Reveal key={p.t} delay={0.1 + i * 0.08}>
              <div className={`flex h-full flex-col rounded-[var(--radius-media)] p-7 sm:p-9 ${p.featured ? "bg-lp-ink text-lp-bg" : "bg-lp-bg-2"}`}>
                <h3 className="text-2xl font-semibold">{p.t}</h3>
                <p className="mt-4">
                  <span className="lp-display text-[64px] leading-none">{p.price}</span>
                  <span className={`ml-2 ${p.featured ? "text-lp-bg/70" : "text-lp-ink-2"}`}>{p.unit}</span>
                </p>
                <p className={`mt-5 max-w-[40ch] text-[17px] leading-relaxed ${p.featured ? "text-lp-bg/80" : "text-lp-ink-2"}`}>{p.d}</p>
                <Link href={startPath("/start", { plan: p.id, lang })} className={`lp-btn mt-8 self-start ${p.featured ? "lp-btn-primary" : "lp-btn-ghost"}`}>
                  {t.nav.start}
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="mt-5 text-sm text-lp-ink-3">{t.pricing.vat}</p>
      </Container>
    </section>
  );
}

function Closing({ t, lang, contactEmail, requiresCard }: { t: Copy; lang: Lang; contactEmail: string | null; requiresCard: boolean }) {
  return (
    <section className="border-t border-lp-line py-24 text-center md:py-32">
      <Container>
        <Reveal>
          <h2 className="lp-display mx-auto max-w-[14ch] text-[48px] sm:text-[64px] md:text-[84px]">{t.closing.h}</h2>
        </Reveal>
        <Reveal delay={0.08}>
          <p className="mx-auto mt-5 max-w-[44ch] text-balance text-lg text-lp-ink-2 sm:text-xl">{t.closing.sub}</p>
        </Reveal>
        <Reveal delay={0.14}>
          <Link href={startPath("/start", { lang })} className="lp-btn lp-btn-primary mt-9 min-h-14 px-7 text-lg">
            {t.nav.start}
            <ArrowRight size={20} weight="bold" />
          </Link>
          <p className="mt-4 text-[15px] font-medium text-lp-ink-2">{trialLine(t, requiresCard)}</p>
          {contactEmail ? (
            <p className="mt-6 text-[15px] text-lp-ink-3">
              {t.nav.contact}: <a href={`mailto:${contactEmail}`} className="select-text font-medium text-lp-ink-2 underline-offset-4 hover:underline">{contactEmail}</a>
            </p>
          ) : null}
        </Reveal>
      </Container>
    </section>
  );
}

function Footer({ t }: { t: Copy }) {
  return (
    <footer className="border-t border-lp-line py-8 text-sm text-lp-ink-3">
      <Container className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>{t.footer.place}</span>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <a href={COFFIQUE_URL} className="transition-colors hover:text-lp-ink">{t.footer.coffique}</a>
          <a href={TELEGRAM_URL} className="transition-colors hover:text-lp-ink">{t.footer.telegram}</a>
          <Link href="/privacy" className="transition-colors hover:text-lp-ink">{t.footer.privacy}</Link>
          <Link href="/data-deletion" className="transition-colors hover:text-lp-ink">{t.footer.deletion}</Link>
        </div>
      </Container>
    </footer>
  );
}
