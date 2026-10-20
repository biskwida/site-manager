// app/(landing)/page.tsx — `/`: the getclaudia.app landing page, for everyone (no redirect). The server picks the language
// (?lang=, the claudia-lang cookie, Accept-Language, then English: the landing's own fallback, unlike the app's Bulgarian) and reads the session, so the nav says "Log in" or "Dashboard" in the first HTML.
import type { Metadata, Viewport } from "next";
import { Landing } from "./components/Landing";
import { loadConfig } from "@/src/config";
import { resolveAppHost } from "@/src/server/host";
import { firstParam, readPageLang } from "@/src/server/request-lang";
import { getSessionUser } from "@/src/server/session";

// Title and Open Graph belong to `/` only (a page-level export; the root layout keeps the app's default).
export const metadata: Metadata = {
  metadataBase: new URL(`https://${resolveAppHost(process.env)}`),
  title: "Claudia",
  description: "Your business online, run from one chat. Send a message, a voice note or a photo; Claudia shows the change, you tap once, and it's live.",
  openGraph: {
    title: "Claudia",
    description: "Your business online, run from one chat.",
    images: [{ url: "/landing/poster.jpg", width: 1920, height: 1080 }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1917" },
  ],
};

const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[A-Za-z]{2,24}$/;

export default async function Page({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const [initialLang, user] = await Promise.all([readPageLang(firstParam(sp.lang), "en"), getSessionUser()]);
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
  return <Landing initialLang={initialLang} signedIn={user !== null} contactEmail={email && EMAIL_RE.test(email) ? email : null} requiresCard={loadConfig(process.env, { lenient: true }).trialRequiresCard} />;
}
