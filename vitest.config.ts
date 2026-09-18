import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: "./test/setup-db.ts",
    setupFiles: ["./test/clean.ts"],
    testTimeout: 30_000,
    exclude: ["node_modules", "dist"],
  },
});
