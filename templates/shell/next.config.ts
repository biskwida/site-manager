import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Inlined at build time: templates link to / and /menu instead of /<slug> (src/templates/shared/links.ts).
  env: { NEXT_PUBLIC_SITE_STANDALONE: "1" },
  turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } },
  images: { remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }] },
};
export default nextConfig;
