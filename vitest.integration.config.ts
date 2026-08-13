import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.integration.test.ts", "packages/**/*.integration.test.ts"],
    passWithNoTests: true,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
    maxWorkers: 1,
  },
});
