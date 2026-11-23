import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Integration tests against a real Postgres (see tests/db/README.md).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
