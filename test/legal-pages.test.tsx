// test/legal-pages.test.tsx — the public /privacy and /data-deletion pages (BG default, EN with ?lang=en), the deletion status
// lookup by confirmation code, and the landing footer links Meta's reviewers follow.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import DataDeletionPage from "@/app/data-deletion/page";
import PrivacyPage from "@/app/privacy/page";
import { Landing } from "@/app/(landing)/components/Landing";
import { DICTS } from "@/src/i18n/dicts";
import { makeServerDeps, type ServerDeps } from "@/src/server/deps";
import { privacyContactEmail } from "@/src/server/legal";
import { RESERVED_SLUGS } from "@/src/wizard/schema";

const g = globalThis as { __siteManagerDeps?: Promise<ServerDeps> | null };
const env0 = process.env.PRIVACY_CONTACT_EMAIL;
afterEach(() => {
  g.__siteManagerDeps = undefined;
  if (env0 === undefined) delete process.env.PRIVACY_CONTACT_EMAIL;
  else process.env.PRIVACY_CONTACT_EMAIL = env0;
});

const sp = (o: Record<string, string>) => ({ params: Promise.resolve({}), searchParams: Promise.resolve(o) });
const privacy = async (o: Record<string, string> = {}) => renderToStaticMarkup(await PrivacyPage(sp(o) as never));
const deletion = async (o: Record<string, string> = {}) => renderToStaticMarkup(await DataDeletionPage(sp(o) as never));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

async function serveMemory() {
  const deps = await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory", PUBLIC_BASE_URL: "https://site.example" }, log: () => {} });
  g.__siteManagerDeps = Promise.resolve(deps);
  return deps;
}

describe("contact email", () => {
  it("reads PRIVACY_CONTACT_EMAIL, ignores anything that is not an address", () => {
    expect(privacyContactEmail({ PRIVACY_CONTACT_EMAIL: " privacy@cafe.example " })).toBe("privacy@cafe.example");
    expect(privacyContactEmail({ PRIVACY_CONTACT_EMAIL: "not an email" })).toBeNull();
    expect(privacyContactEmail({})).toBeNull();
  });
});

describe("/privacy", () => {
  it("renders in Bulgarian by default with every section and a link to /data-deletion", async () => {
    process.env.PRIVACY_CONTACT_EMAIL = "privacy@cafe.example";
    const html = await privacy();
    const t = text(html);
    for (const k of ["privacy.title", "privacy.who.title", "privacy.data.title", "privacy.why.title", "privacy.meta.title", "privacy.where.title", "privacy.third.title", "privacy.retention.title", "privacy.rights.title", "privacy.delete.title"] as const) {
      expect(t, k).toContain(DICTS.bg[k]);
    }
    expect(html).toContain('href="mailto:privacy@cafe.example"');
    expect(html).toContain('href="/data-deletion"');
    for (const name of ["Meta", "Telegram", "Anthropic", "Vercel", "Supabase"]) expect(t).toContain(name);
    expect(t).not.toContain(DICTS.en["privacy.title"]);
  });

  it("renders in English with ?lang=en; without a contact email it points to the bot", async () => {
    delete process.env.PRIVACY_CONTACT_EMAIL;
    const t = text(await privacy({ lang: "en" }));
    expect(t).toContain(DICTS.en["privacy.title"]);
    expect(t).toContain(DICTS.en["privacy.meta.body"]);
    expect(t).toContain(DICTS.en["privacy.contact.none"]);
    expect(t).not.toContain("mailto:");
  });
});

describe("/data-deletion", () => {
  it("lists the three ways in BG and EN", async () => {
    await serveMemory();
    const bg = text(await deletion());
    for (const k of ["deletion.title", "deletion.way1.title", "deletion.way2.title", "deletion.way3.title"] as const) expect(bg).toContain(DICTS.bg[k]);
    const en = text(await deletion({ lang: "en" }));
    for (const k of ["deletion.title", "deletion.way1.title", "deletion.way2.title", "deletion.way3.title"] as const) expect(en).toContain(DICTS.en[k]);
  });

  it("?code= shows the status of a completed, a pending and an unknown request", async () => {
    const deps = await serveMemory();
    const done = await deps.store.createDeletionRequest({ provider: "facebook", subject_id: "9001", now: "2026-10-14T09:00:00.000Z" });
    await deps.store.completeDeletionRequest(done.confirmation_code, "2026-10-14T09:00:01.000Z");
    const pending = await deps.store.createDeletionRequest({ provider: "instagram", subject_id: "5501", now: "2026-10-14T10:00:00.000Z" });

    const en = text(await deletion({ code: done.confirmation_code, lang: "en" }));
    expect(en).toContain(done.confirmation_code);
    expect(en).toContain(DICTS.en["deletion.status.completed"].replace("{date}", "2026-10-14"));
    expect(en).not.toContain("9001");
    const bg = text(await deletion({ code: pending.confirmation_code }));
    expect(bg).toContain(DICTS.bg["deletion.status.pending"].replace("{date}", "2026-10-14"));
    expect(text(await deletion({ code: "ZZZZZZZZZZZZ", lang: "en" }))).toContain(DICTS.en["deletion.status.unknown"]);
    expect(text(await deletion({ code: "<script>", lang: "en" }))).toContain(DICTS.en["deletion.status.unknown"]);
  });
});

describe("landing footer and slugs", () => {
  it("links to both pages", () => {
    const html = renderToStaticMarkup(<Landing initialLang="bg" signedIn={false} contactEmail={null} />);
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/data-deletion"');
    expect(text(html)).toContain(DICTS.bg["legal.privacy"]);
    expect(text(html)).toContain(DICTS.bg["legal.deletion"]);
  });

  it("no venue can take the pages' addresses", () => {
    expect(RESERVED_SLUGS).toEqual(expect.arrayContaining(["privacy", "data-deletion"]));
  });
});
