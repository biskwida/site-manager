// src/visual/cutout.ts
// Server-only, and imported only by app/api/visual/route.ts: the model and its runtime are large, so no other function
// bundles them (see next.config.ts). Removes the background locally (no paid API) with the "small" model, which on our
// test photos cuts as cleanly as "medium" at half the size, then trims the transparent margins.
import path from "node:path";
import { removeBackground } from "@imgly/background-removal-node";

const PUBLIC_PATH = `file://${path.join(process.cwd(), "node_modules/@imgly/background-removal-node/dist")}/`;

function typeOf(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return "image/webp";
  return "image/jpeg";
}

/** The subject as a trimmed PNG with a transparent background, or null when the model finds (almost) nothing. */
export async function cutout(bytes: Uint8Array): Promise<Uint8Array | null> {
  const blob = new Blob([bytes as BlobPart], { type: typeOf(bytes) });
  const out = await removeBackground(blob, { model: "small", publicPath: PUBLIC_PATH, output: { format: "image/png", quality: 1 } });
  const png = Buffer.from(await out.arrayBuffer());
  const sharp = (await import("sharp")).default;
  const { channels } = await sharp(png).stats();
  const alpha = channels[3];
  // Under 3% of the picture kept: nothing worth cutting out (a plain table, a blurry shot).
  if (!alpha || alpha.mean < 0.03 * 255) return null;
  return new Uint8Array(await sharp(png).trim({ threshold: 8 }).png().toBuffer());
}
