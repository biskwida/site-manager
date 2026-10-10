import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "node",
  },
  resolve: {
    alias: { "@": new URL("./", import.meta.url).pathname },
  },
});
