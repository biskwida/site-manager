import { describe, expect, it } from "vitest";
import { ChannelRouter } from "@/src/channels/router";
import { FakeMessenger, makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");

describe("ChannelRouter", () => {
  it("dispatches by prefix and drops refs of unconfigured channels with one log line", async () => {
    const { store } = await makeDemo();
    const tg = new FakeMessenger(); const fb = new FakeMessenger();
    const logs: string[] = []; const orig = console.error; console.error = (...a: unknown[]) => { logs.push(a.join(" ")); };
    try {
      const r = new ChannelRouter({ store, now: () => T0, adapters: { tg, fb, ig: fb } });
      expect(await r.send("tg:1001", "a")).toBe("100");
      expect(await r.send("ig:5", "b")).toBe("100");
      expect(await r.send("wa:359", "c")).toBeNull();
      expect(await r.send("wa:359", "d")).toBeNull();
      await r.conclude("fb:5", "m1", "full", "short");
      await r.typing("tg:1001", "7");
      expect(tg.sent.map((s) => s.text)).toEqual(["a"]);
      expect(fb.sent.map((s) => s.text)).toEqual(["b"]);
      expect(fb.concluded[0]).toMatchObject({ chatRef: "fb:5", short: "short" });
      expect(tg.typed).toEqual(["tg:1001"]);
      expect(logs.filter((l) => l.includes("no adapter for channel wa"))).toHaveLength(1);
    } finally { console.error = orig; }
  });
  it("sends proactive messages on Meta channels only within 23 h of the owner's last message", async () => {
    const { store, venue } = await makeDemo();
    const fb = new FakeMessenger(); const tg = new FakeMessenger();
    await store.upsertMember({ venue_id: venue.id, chat_ref: "fb:5", role: "owner", lang: "bg", last_seen_at: "2026-10-09T08:00:00.000Z" });
    const r = new ChannelRouter({ store, now: () => T0, adapters: { tg, fb } });
    expect(await r.send("fb:5", "reminder", { proactive: true })).toBe("100");
    await store.touchMember("fb:5", "2026-10-08T09:30:00.000Z"); // 23.5 h ago
    expect(await r.send("fb:5", "reminder2", { proactive: true })).toBeNull();
    await r.conclude("fb:5", null, "full", "expired", { proactive: true });
    expect(fb.sent.map((s) => s.text)).toEqual(["reminder"]);
    expect(fb.concluded).toEqual([]);
    expect(await r.send("fb:5", "reply", {})).toBe("101"); // not proactive: always sent
    expect(await r.send("tg:1001", "tg reminder", { proactive: true })).toBe("100"); // Telegram: no window
    expect(await r.send("fb:unknown", "x", { proactive: true })).toBeNull(); // no member: skipped
  });
});
