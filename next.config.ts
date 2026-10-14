import type { NextConfig } from "next";

const supabaseHost = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname : null;
  } catch {
    return null;
  }
})();

// Hash-named chunk files of the "medium" background-removal model, which the picture service does not use (see cutout.ts).
const MEDIUM_MODEL_CHUNKS = `./node_modules/@imgly/background-removal-node/dist/{${["01f6efcc8a01c727d99073ceede8e64c654fa3c4612b006e69e22dc663236943", "024e3d8beaf517d25496b73e36b0e0498110652753273e0dd8b591ad7c1c9e2f", "0c8c5c24237304482ccc70a50008b73c8ef53e4656068da32b635607cca0c8c9", "145d8355f50b7847de5d04815124790867fe1752a0013bdf6ce28882b5e0a2fc", "1b8eaad4cd019b76e7eba964a38711a0bdeafbd10b6208c1107403a64dbd902a", "230f667e0332dc09ef08aacbf1992c40ce112192f95dfc14231a3ef515f9a2c7", "3315eb3c14ca3ff5c03c80fac58f486a14264dd0bb9c168c096f2bd2531ba438", "3f31511c3c16a29cf81b32379f51ead2bd082677b48b1dcc11a66beeb37cc729", "3f5638267419916c9d4d906ff25f721d3d2e034851ea01566f0d2d6f943550b8", "4c44c8b64af9f044623ceace7cc55e0bc348394f7ff63629d46118c0a03c9c54", "529f1df7d027b0315090ba15d42ef32998cac2efd6783c62f6b11cedf4c548f3", "6cfd013f552a05e9fc81156e6d6de593668e0247a3970feae22e285c16d13e62", "724543b36c7b5eddfbd7f55cb5a7c1676b2089c277611850c257efa42212d8a2", "7b1dd767c5c1c0156b8d13bb34d4c1d11e014723b10cddc25c93e89a28e7cd96", "897d4d8a3f9f8c07f439300a5d81c8be4b0fcecf19ca6d77929b1750fedd8306", "8b2e3d773d7084c5cfac1c04d69d3586e4b8914a840d2b582dfde4940d698957", "9927e74b3a0638d4cf5701e78e66d77476a4ba68c75831f1c8ea9117ec7f8809", "a5b8c519c832bc46b2ae5a9887fac1e3d5cc76a04846d8c3544875c7f2b40960", "cbcda0a0c830ba51928e7935d9d3cfe1c4dc258bf117f2c76d047113ab8f9f8c", "e01a157b677e0e17815cd738dcda7e6daa268898d006b52b5d3604c439e6c96e", "f9290547b2e34555536647c1e2ca456348170eef1aee05d8fd522f5a051f260c", "fe1b9f06af9d2147016884f4eb683d4dc540244a7453c3b742ae527725df2eec"].join(",")}}`;

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
    // The picture service reads its fonts and the background-removal model from disk.
    "/api/visual": ["./src/visual/fonts/**/*", "./node_modules/@imgly/background-removal-node/dist/**/*", "./node_modules/onnxruntime-node/bin/napi-v3/linux/x64/**/*"],
  },
  // Keep the model out of every other function, and keep only what the picture service needs: Linux x64 binaries and
  // the "small" model (the "medium" model's chunks are listed by hash in the package's resources.json).
  outputFileTracingExcludes: {
    "/api/**": ["./node_modules/onnxruntime-node/bin/napi-v3/darwin/**/*", "./node_modules/onnxruntime-node/bin/napi-v3/win32/**/*", "./node_modules/onnxruntime-node/bin/napi-v3/linux/arm64/**/*"],
    "/api/visual": [MEDIUM_MODEL_CHUNKS],
  },
  // Native and wasm-heavy packages load at runtime from node_modules instead of being bundled.
  serverExternalPackages: ["@imgly/background-removal-node", "onnxruntime-node", "sharp"],
};
export default nextConfig;
