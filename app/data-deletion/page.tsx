// Public data deletion instructions (Meta App Review: User Data Deletion URL) and the status of a deletion request
// (?code=<confirmation code>, the URL our Data Deletion Request callback hands Meta). BG by default, EN with ?lang=en.
import type { Metadata } from "next";
import { after } from "next/server";
import { DataDeletion, type DeletionStatusProps } from "@/app/components/Legal";
import { LangProvider } from "@/src/i18n";
import { DICTS } from "@/src/i18n/dicts";
import { getServerDeps } from "@/src/server/deps";
import { pageLang, privacyContactEmail } from "@/src/server/legal";
import { deletionStatus } from "@/src/server/meta-deletion";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${DICTS.bg["deletion.title"]} · ${DICTS.en["deletion.title"]} · Claudia`, robots: { index: true, follow: true } };

async function lookup(raw: string | string[] | undefined): Promise<DeletionStatusProps | null> {
  const code = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 32);
  if (!code) return null;
  try {
    const deps = await getServerDeps((fn) => after(fn));
    const s = await deletionStatus(deps.store, code);
    return { code: code.toUpperCase(), status: s };
  } catch (e) {
    console.error(`[data-deletion] status lookup failed: ${e instanceof Error ? e.message : "error"}`);
    return { code: code.toUpperCase(), status: null };
  }
}

export default async function Page(props: PageProps<"/data-deletion">) {
  const sp = await props.searchParams;
  return (
    <LangProvider defaultLang={pageLang(sp.lang)}>
      <DataDeletion contactEmail={privacyContactEmail()} lookup={await lookup(sp.code)} />
    </LangProvider>
  );
}
