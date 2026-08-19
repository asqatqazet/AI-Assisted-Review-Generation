import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "acceptance/**/*.test.ts",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx",
      "infra/**/*.test.ts",
    ],
    exclude: ["**/*.integration.test.ts", "**/node_modules/**", "**/dist/**"],
    testTimeout: 10_000,
  },
});
