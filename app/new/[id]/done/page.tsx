// app/new/[id]/done/page.tsx: the hand-off after publish. Proof of ownership is the wizard cookie alone; ?code= and ?key=
// (from the publish redirect) only save a round trip. The slug comes from the venue, never from the (now empty) draft.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { INVITE_TTL_MS } from "@/src/bot/bot";
import { LangProvider } from "@/src/i18n";
import { DICTS } from "@/src/i18n/dicts";
import { getServerDeps } from "@/src/server/deps";
import { DRAFT_COOKIE, venueFromDraftCookie } from "@/src/server/draft-cookie";
import { DoneStatus, type DoneStatusResponse } from "./DoneStatus";

export const dynamic = "force-dynamic";

// The admin key and the invite code sit in this page's URL: no indexing, no Referer. next.config.ts already keeps ?key= out of the request log.
export const metadata: Metadata = {
  title: `${DICTS.bg["done.title"]} · ${DICTS.en["done.title"]}`,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
/** Invite codes are 8 chars from the bot's alphabet; anything else in ?code= is ignored (a fresh code is issued instead). */
const CODE = /^[A-Z2-9]{8}$/;
/** A fresh single-use owner invite (INVITE_TTL_MS from now). */
const newOwnerInvite = (store: { createInvite(venueId: string, role: "owner", expiresAt: string): Promise<string> }, venueId: string) =>
  store.createInvite(venueId, "owner", new Date(Date.now() + INVITE_TTL_MS).toISOString());

export default async function Page(props: PageProps<"/new/[id]/done">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const deps = await getServerDeps((fn) => after(fn));
  const jar = await cookies();
  const venue = await venueFromDraftCookie(deps.store, jar.get(DRAFT_COOKIE)?.value, id);
  if (!venue) notFound();
  if (venue.status !== "live") redirect(`/new/${encodeURIComponent(id)}`);
  const joined = (await deps.store.listMembers(venue.id)).some((m) => m.role === "owner");
  // The publish redirect carries the fresh invite code. A reload without it gets a new single-use code (7 days), unless the owner already pressed Start.
  const fromUrl = one(sp.code)?.toUpperCase() ?? null;
  const code = joined ? null : fromUrl && CODE.test(fromUrl) ? fromUrl : await newOwnerInvite(deps.store, venue.id);
  const adminKey = one(sp.key) || (await deps.store.getAdminToken(venue.id));
  const bot = deps.config.telegramBotUsername;
  const initial: DoneStatusResponse = { status: venue.status, deploy: venue.deploy, site_url: venue.deploy?.status === "ready" ? venue.deploy.url : null };
  return (
    <LangProvider defaultLang={venue.default_lang}>
      <DoneStatus id={id} slug={venue.slug} code={code} startUrl={bot && code ? `https://t.me/${bot}?start=${code}` : null} adminKey={adminKey} baseUrl={deps.config.publicBaseUrl} initial={initial} />
    </LangProvider>
  );
}
