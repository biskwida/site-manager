// test/admin-change-limit.test.tsx — the dashboard's "Changes this month" line (monthly change limit) and its overview data.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LogList } from "@/app/admin/[slug]/components/LogList";
import { LangProvider } from "@/src/i18n";
import { adminOverview } from "@/src/server/admin";
import { makeDemo } from "./helpers";

const T0 = new Date("2026-10-13T09:00:00.000Z");

describe("adminOverview change usage", () => {
  it("exposes this month's applied changes (in the venue's zone) and the limit; null limit when unlimited", async () => {
    const { store, venue } = await makeDemo();
    const applied = async (source: "text" | "undo", at: string) => {
      const cs = await store.createChangeSet({ venue_id: venue.id, chat_ref: null, summary_bg: "x", summary_en: "x", preview_bg: "x", preview_en: "x", source, status: "proposed", changes: [] });
      await store.applyChangeSet(cs.id, at);
    };
    await applied("text", "2026-10-01T08:00:00.000Z");
    await applied("text", "2026-09-30T21:30:00.000Z"); // 1 Oct 00:30 Sofia: this month
    await applied("text", "2026-09-30T20:30:00.000Z"); // 30 Sep 23:30 Sofia: last month
    await applied("undo", "2026-10-02T08:00:00.000Z");
    expect((await adminOverview(store, venue, T0)).changes_this_month).toEqual({ used: 2, limit: null });
    const limited = await store.setChangeLimit(venue.id, 60);
    expect((await adminOverview(store, limited, T0)).changes_this_month).toEqual({ used: 2, limit: 60 });
  });
});

describe("LogList usage line", () => {
  const render = (lang: "bg" | "en", usage: { used: number; limit: number | null } | undefined) =>
    renderToStaticMarkup(<LangProvider defaultLang={lang}><LogList sets={[]} tz="Europe/Sofia" decide={async () => true} usage={usage} /></LangProvider>);
  it("shows the count against the limit in the card header, in both languages", () => {
    expect(render("en", { used: 12, limit: 60 })).toContain("Changes this month: 12 / 60");
    expect(render("bg", { used: 12, limit: 60 })).toContain("Промени този месец: 12 / 60");
  });
  it("marks a reached limit and says when it resets", () => {
    const html = render("en", { used: 60, limit: 60 });
    expect(html).toContain("Changes this month: 60 / 60");
    expect(html).toContain("Limit reached");
  });
  it("shows nothing when the venue is unlimited (or an older server sent no usage)", () => {
    expect(render("en", { used: 12, limit: null })).not.toContain("Changes this month");
    expect(render("en", undefined)).not.toContain("Changes this month");
  });
});
