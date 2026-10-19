// app/start/social/page.tsx — path C, "only social media". Needs a signed-in account; the form creates the venue.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountShell, otherLangHref } from "@/app/components/AccountShell";
import { StartVenueForm } from "@/app/start/StartVenueForm";
import { parsePlan, startPath } from "@/src/auth/start-links";
import { firstParam, readPageLang } from "@/src/server/request-lang";
import { getSessionUser } from "@/src/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Започнете · Start · Claudia", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: PageProps<"/start/social">) {
  const sp = await searchParams;
  const plan = parsePlan(firstParam(sp.plan));
  const lang = await readPageLang(sp.lang);
  if (!(await getSessionUser())) redirect(startPath("/start", { plan, lang }));
  return (
    <AccountShell lang={lang} otherLangHref={otherLangHref("/start/social", { plan: plan ?? undefined }, lang)}>
      <StartVenueForm path="none" lang={lang} backHref={startPath("/start/choose", { plan, lang })} />
    </AccountShell>
  );
}
