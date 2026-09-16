import { cloudflarePool } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["worker/**/*.test.ts"],
    pool: cloudflarePool({
      remoteBindings: false,
      main: "./worker/index.ts",
      miniflare: {
        compatibilityDate: "2026-08-22",
        compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
      },
    }),
  },
});
