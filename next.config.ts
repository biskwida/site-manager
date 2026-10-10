import type { NextConfig } from "next";

const supabaseHost = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname : null;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  // Dev request log: never print the owner's key (admin pages, admin API, draft previews with ?key=), the tick path, or the
  // Instagram OAuth callback (its query holds the one-time code and the signed state).
  logging: { incomingRequests: { ignore: [/\/admin\//, /\/api\/admin\//, /\/api\/tick/, /[?&]key=/, /\/api\/new\/instagram\/callback/] } },
  turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      ...(supabaseHost ? [{ protocol: "https" as const, hostname: supabaseHost }] : []),
    ],
  },
  // The deployer inlines these files into each venue's Vercel deployment; without this they would not exist in the serverless functions.
  outputFileTracingIncludes: {
    "/api/**": ["./templates/shell/**/*", "./src/templates/**/*", "./src/domain/**/*", "./src/time.ts", "./src/i18n/**/*"],
  },
};
export default nextConfig;
