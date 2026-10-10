// test/hash.test.ts
import { describe, expect, it } from "vitest";
import { newDraftToken, sha256Hex } from "@/src/server/hash";

describe("hash", () => {
  it("sha256Hex is the standard hex digest", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
  it("newDraftToken is 64 hex chars and unique", () => {
    const a = newDraftToken();
    const b = newDraftToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
