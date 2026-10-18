// test/progress.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { progressLabel, startProgress } from "@/src/bot/progress";
import { FakeMessenger } from "./helpers";

describe("startProgress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps Telegram's typing on, shows a status after 3 s, edits it per step and removes it at the end", async () => {
    const m = new FakeMessenger();
    const p = startProgress({ messenger: m, chatRef: "tg:1001", lang: "bg", hasImage: false });
    expect(m.typed).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_900);
    expect(m.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sent.map((s) => s.text)).toEqual(["⏳ Работя по това…"]);
    p.step("get_menu");
    p.step("get_menu"); // same label: no second edit
    await vi.advanceTimersByTimeAsync(0);
    p.step("propose_changes");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(m.edited.map((e) => e.text)).toEqual(["📖 Чета менюто…", "📝 Подготвям предложението…"]);
    expect(m.typed.length).toBeGreaterThanOrEqual(3); // every 4 s on Telegram
    await p.stop();
    expect(m.removed).toEqual([{ chatRef: "tg:1001", messageRef: m.sent[0].messageRef }]);
    const typedAtStop = m.typed.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(m.typed).toHaveLength(typedAtStop);
  });

  it("sends nothing but typing when the answer comes within 3 s", async () => {
    const m = new FakeMessenger();
    const p = startProgress({ messenger: m, chatRef: "tg:1001", lang: "en", hasImage: true });
    await vi.advanceTimersByTimeAsync(1_000);
    await p.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(m.sent).toHaveLength(0);
    expect(m.removed).toHaveLength(0);
  });

  it("starts with the photo label when a photo came with the message, and uses the latest step when the status appears", async () => {
    const m = new FakeMessenger();
    const p = startProgress({ messenger: m, chatRef: "tg:1001", lang: "en", hasImage: true });
    p.step("social_post");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(m.sent.map((s) => s.text)).toEqual(["📣 Preparing the post…"]);
    await p.stop();
  });

  it("on Messenger and WhatsApp sends one status line, never edits or removes it, and repeats typing every 15 s", async () => {
    const m = new FakeMessenger();
    const p = startProgress({ messenger: m, chatRef: "wa:359888", lang: "bg", hasImage: false, inReplyTo: "wamid.1" });
    await vi.advanceTimersByTimeAsync(3_000);
    p.step("get_menu");
    await vi.advanceTimersByTimeAsync(31_000);
    await p.stop();
    expect(m.sent.map((s) => s.text)).toEqual(["⏳ Работя по това…"]);
    expect(m.edited).toHaveLength(0);
    expect(m.removed).toHaveLength(0);
    expect(m.typed).toHaveLength(3); // at start, 15 s, 30 s
  });
});

describe("progressLabel", () => {
  it("names the step in the owner's language and has a label for WordPress tools", () => {
    expect(progressLabel("get_menu", "en")).toBe("📖 Reading the menu…");
    expect(progressLabel("wp_edit_page", "bg")).toBe("🌐 Работя по WordPress сайта…");
    expect(progressLabel("something_new", "bg")).toBeNull();
    expect(progressLabel("propose_boost", "bg")).toBe("🔎 Анализирам района, последователите и постовете за най-добрия план…");
    expect(progressLabel("propose_boost", "en")).toBe("🔎 Analysing your area, followers and posts for the best ad plan…");
  });
});
