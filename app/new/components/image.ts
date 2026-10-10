"use client";
// Client-side image shrinking, so phone photos (often 8–12 MB) pass the upload and extraction limits without the owner noticing.

export interface ShrinkOptions {
  /** Longest edge in px after shrinking. */
  maxEdge: number;
  /** JPEG/WebP quality for the first attempt; lowered on retries. */
  quality: number;
  /** The encoded result must be under this; null when it cannot be reached. */
  maxBytes: number;
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall through to the <img> decoder (older Safari with HEIC-converted JPEGs)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Returns the file itself when it already fits (small enough and within maxEdge), otherwise a re-encoded copy.
 * PNG stays PNG only while that fits (logos with transparency); everything else becomes JPEG. GIFs are never re-encoded.
 * Null means no encoding got under maxBytes.
 */
export async function shrinkImage(file: File, o: ShrinkOptions): Promise<File | null> {
  if (!file.type.startsWith("image/")) return file; // the server decides what to do with it
  if (file.type === "image/gif") return file.size <= o.maxBytes ? file : null;
  let img: ImageBitmap | HTMLImageElement;
  try {
    img = await decode(file);
  } catch {
    return file.size <= o.maxBytes ? file : null;
  }
  try {
    return await encode(file, img, o);
  } finally {
    if ("close" in img) img.close(); // ImageBitmaps hold decoded pixels until closed
  }
}

async function encode(file: File, img: ImageBitmap | HTMLImageElement, o: ShrinkOptions): Promise<File | null> {
  const w = "naturalWidth" in img ? img.naturalWidth : img.width;
  const h = "naturalHeight" in img ? img.naturalHeight : img.height;
  const longest = Math.max(w, h);
  if (longest <= o.maxEdge && file.size <= o.maxBytes) return file;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return file.size <= o.maxBytes ? file : null;
  let edge = Math.min(longest, o.maxEdge);
  let quality = o.quality;
  const keepPng = file.type === "image/png";
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = edge / longest;
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const type = keepPng && attempt === 0 ? "image/png" : "image/jpeg";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (type === "image/jpeg") {
      // JPEG has no alpha: a transparent logo would turn black. Paint it on white first.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await toBlob(canvas, type, quality);
    if (blob && blob.size <= o.maxBytes) {
      const ext = type === "image/png" ? "png" : "jpg";
      return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + "." + ext, { type });
    }
    // Shrink further: a little less quality, a smaller edge.
    quality = Math.max(0.55, quality - 0.1);
    edge = Math.round(edge * 0.8);
  }
  return null;
}
