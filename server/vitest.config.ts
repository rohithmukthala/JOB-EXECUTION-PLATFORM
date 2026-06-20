import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false, // tests share one DB; run sequentially
    hookTimeout: 20_000,
    testTimeout: 20_000,
  },
});
