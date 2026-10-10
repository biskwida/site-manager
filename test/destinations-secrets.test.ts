// test/destinations-secrets.test.ts
import { describe, expect, it } from "vitest";
import { DEV_SECRET_KEY_HEX, decryptSecrets, encryptSecrets, parseSecretKey, resolveSecretKey } from "@/src/destinations/secrets";

const KEY = parseSecretKey("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff");

describe("destination secrets", () => {
  it("round-trips a record and never repeats the ciphertext", () => {
    const a = encryptSecrets({ token: "t-1", other: "x" }, KEY);
    const b = encryptSecrets({ token: "t-1", other: "x" }, KEY);
    expect(a).not.toBe(b); // fresh IV each time
    expect(a).not.toContain("t-1");
    expect(decryptSecrets(a, KEY)).toEqual({ token: "t-1", other: "x" });
    expect(decryptSecrets(b, KEY)).toEqual({ token: "t-1", other: "x" });
  });
  it("rejects a tampered blob and a wrong key", () => {
    const blob = encryptSecrets({ token: "t-1" }, KEY);
    const bytes = Buffer.from(blob, "base64");
    bytes[bytes.length - 1] ^= 1;
    expect(() => decryptSecrets(bytes.toString("base64"), KEY)).toThrow(/decrypt/);
    expect(() => decryptSecrets(blob, parseSecretKey("ff".repeat(32)))).toThrow(/decrypt/);
    expect(() => decryptSecrets("not-base64!!", KEY)).toThrow(/decrypt/);
  });
  it("parses hex and base64 keys and rejects other lengths", () => {
    expect(parseSecretKey("ab".repeat(32))).toHaveLength(32);
    expect(parseSecretKey(Buffer.alloc(32, 7).toString("base64"))).toHaveLength(32);
    expect(() => parseSecretKey("short")).toThrow(/DESTINATION_SECRET_KEY must be 32 bytes/);
    expect(() => parseSecretKey("ab".repeat(16))).toThrow(/32 bytes/);
  });
  it("falls back to the dev key only in memory mode", () => {
    const logs: string[] = [];
    expect(resolveSecretKey(null, true, (s) => logs.push(s))?.equals(parseSecretKey(DEV_SECRET_KEY_HEX))).toBe(true);
    expect(logs[0]).toMatch(/DESTINATION_SECRET_KEY/);
    expect(resolveSecretKey(null, false)).toBeNull();
    expect(resolveSecretKey("ab".repeat(32), false)?.equals(parseSecretKey("ab".repeat(32)))).toBe(true);
  });
});
