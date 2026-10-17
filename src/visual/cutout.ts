// src/visual/cutout.ts
// Server-only, and imported only by app/api/visual/route.ts: the model and its runtime are large, so no other function
// bundles them (see next.config.ts). Removes the background locally (no paid API) with the "small" model, which on our
// test photos cuts as cleanly as "medium" at half the size, keeps only the main object (a piece of the table can survive the model),
// then trims the transparent margins (by alpha: the default trim keys on the top-left pixel and misses an object touching that corner).
import path from "node:path";
import { removeBackground } from "@imgly/background-removal-node";
import { keepMainObject } from "./main-object";

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
  const main = await keepMainObject(png);
  // Under 3% of the picture kept: nothing worth cutting out (a plain table, a blurry shot).
  if (main.coverage < 0.03) return null;
  return new Uint8Array(await sharp(main.png).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 }).png().toBuffer());
}
