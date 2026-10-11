import type { MetadataRoute } from "next";
import { siteUrl } from "./feed";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const lastModified = new Date();
  return [
    { url: base, lastModified, changeFrequency: "daily", priority: 1 },
    { url: `${base}/menu`, lastModified, changeFrequency: "daily", priority: 0.8 },
  ];
}
