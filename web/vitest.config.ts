import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "worker/firestore.test.ts"],
    environment: "node",
  },
});
