// test/wizard-ratelimit.test.ts
import { describe, expect, it } from "vitest";
import { InMemoryStore } from "@/src/store/memory";
import { rateLimitKeys } from "@/src/server/wizard";

const HOUR = 3_600_000;
const at = (ms: number) => new Date(Date.parse("2026-10-09T09:00:00.000Z") + ms).toISOString();

describe("bumpRateLimit through the wizard keys", () => {
  it("allows five per ip per hour, then refuses, then allows again in the next window", async () => {
    const store = new InMemoryStore();
    const keys = rateLimitKeys("abc");
    for (let i = 0; i < 5; i++) expect(await store.bumpRateLimit(keys.ip, HOUR, 5, at(i * 1000))).toBe(true);
    expect(await store.bumpRateLimit(keys.ip, HOUR, 5, at(6000))).toBe(false);
    expect(await store.bumpRateLimit(keys.ip, HOUR, 5, at(HOUR - 1))).toBe(false);
    expect(await store.bumpRateLimit(keys.ip, HOUR, 5, at(HOUR + 1))).toBe(true);
  });
  it("keeps ip windows and the global window independent", async () => {
    const store = new InMemoryStore();
    const a = rateLimitKeys("a");
    const b = rateLimitKeys("b");
    expect(a.global).toBe(b.global);
    expect(a.ip).not.toBe(b.ip);
    for (let i = 0; i < 2; i++) {
      expect(await store.bumpRateLimit(a.ip, HOUR, 2, at(0))).toBe(true);
      expect(await store.bumpRateLimit(a.global, 24 * HOUR, 3, at(0))).toBe(true);
    }
    expect(await store.bumpRateLimit(a.ip, HOUR, 2, at(0))).toBe(false);
    expect(await store.bumpRateLimit(b.ip, HOUR, 2, at(0))).toBe(true);
    expect(await store.bumpRateLimit(b.global, 24 * HOUR, 3, at(0))).toBe(true); // third of three
    expect(await store.bumpRateLimit(b.global, 24 * HOUR, 3, at(0))).toBe(false); // fourth
  });
});
