// test/media.test.ts
import { describe, expect, it } from "vitest";
import { downloadTelegramFile, imageMediaType, MAX_IMAGE_BYTES } from "@/src/bot/media";

describe("downloadTelegramFile", () => {
  it("fetches the file URL built from the token and never puts the URL in an error", async () => {
    const urls: string[] = [];
    const ok = (async (url: string) => {
      urls.push(url);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
    }) as unknown as typeof fetch;
    const r = await downloadTelegramFile("SECRET", "photos/a.jpg", ok);
    expect(urls).toEqual(["https://api.telegram.org/file/botSECRET/photos/a.jpg"]);
    expect(r).toEqual({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" });
    const bad = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(downloadTelegramFile("SECRET", "photos/a.jpg", bad)).rejects.toThrow(/^download failed \(HTTP 404\)$/);
  });
  it("rejects files over the limit", async () => {
    const big = (async () => new Response(new Uint8Array(MAX_IMAGE_BYTES + 1), { status: 200, headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;
    await expect(downloadTelegramFile("S", "x", big)).rejects.toThrow(/too large/);
  });
});

describe("imageMediaType", () => {
  it("prefers the header, falls back to the extension, defaults to jpeg", () => {
    expect(imageMediaType("image/png", "x.bin")).toBe("image/png");
    expect(imageMediaType("application/octet-stream", "photos/x.webp")).toBe("image/webp");
    expect(imageMediaType("application/octet-stream", "photos/x")).toBe("image/jpeg");
    expect(imageMediaType("application/pdf", "doc.pdf")).toBeNull();
    expect(imageMediaType("application/pdf", "x.jpg")).toBeNull();
    expect(imageMediaType("", "photos/x.png")).toBe("image/png");
    expect(imageMediaType("text/html", "x.jpeg")).toBeNull();
  });
});
