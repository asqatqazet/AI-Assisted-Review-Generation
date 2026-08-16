import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.test.ts", "apps/**/*.test.tsx", "packages/**/*.test.ts", "packages/**/*.test.tsx"],
    exclude: ["**/*.integration.test.ts", "**/node_modules/**", "**/dist/**"],
    testTimeout: 10_000,
  },
});
