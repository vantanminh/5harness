import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    env: {
      // Keep unit/e2e free of registry network I/O.
      HARNESS_NO_UPDATE_CHECK: "1",
    },
  },
});
