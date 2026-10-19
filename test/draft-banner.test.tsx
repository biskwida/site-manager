// test/draft-banner.test.tsx — the draft preview bar: key mode as before, account mode (no key) without any ?key=.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { DraftBanner } from "@/app/[slug]/components/DraftBanner";
import { draftBackHref } from "@/app/[slug]/components/draft-links";
import { LangProvider } from "@/src/i18n";
import type { DraftInfo } from "@/src/domain/types";

const draft = (over: Partial<DraftInfo>): DraftInfo => ({ id: "c1", status: "applied", summary_bg: "Промяна", summary_en: "Change", preview_bg: "", preview_en: "", key: "", ...over });
const render = (d: DraftInfo) => renderToStaticMarkup(<LangProvider defaultLang="en"><DraftBanner draft={d} slug="agala" /></LangProvider>);

describe("draftBackHref", () => {
  it("goes back to the key page with a key and to the account dashboard without one", () => {
    expect(draftBackHref("agala", "k 1")).toBe("/admin/agala?key=k%201");
    expect(draftBackHref("agala", "")).toBe("/dashboard/agala");
  });
});

describe("DraftBanner", () => {
  it("links back to the dashboard it came from", () => {
    expect(render(draft({ key: "k" }))).toContain('href="/admin/agala?key=k"');
    const account = render(draft({ key: "" }));
    expect(account).toContain('href="/dashboard/agala"');
    expect(account).not.toContain("key=");
  });
});
