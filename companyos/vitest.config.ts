import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    // Integration tests share one real Postgres/Redis and use randomly
    // generated emails/slugs to avoid collisions, but they still touch
    // shared connection pools — keep them from racing each other.
    fileParallelism: false,
    testTimeout: 20_000,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
