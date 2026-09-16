import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/**/*.test.ts",
      "worker/firestore.test.ts",
      "worker/commits.test.ts",
      "worker/catalog.test.ts",
      "worker/plans.test.ts",
    ],
    environment: "node",
  },
});
