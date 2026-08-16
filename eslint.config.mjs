import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", ".nx/**", "**/generated/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["packages/domain/src/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        "fetch",
        "WebSocket",
        "XMLHttpRequest",
        "EventSource",
        "localStorage",
        "sessionStorage",
        "navigator",
        "process"
      ]
    }
  },
  {
    files: ["apps/generation-service/src/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error", "fetch"],
      "no-restricted-properties": [
        "error",
        {
          "object": "globalThis",
          "property": "fetch",
          "message": "Generation calls provider adapters; it never fetches configuration or other network resources directly."
        },
        {
          "object": "process",
          "property": "env",
          "message": "Generation configuration is an explicit function parameter; environment reads are forbidden in production source."
        }
      ]
    }
  },
);
