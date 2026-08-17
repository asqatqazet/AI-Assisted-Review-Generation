import { defineConfig } from "tsup";

export default defineConfig({
  banner: {
    js: [
      'import { createRequire as __reviewCreateRequire } from "node:module";',
      'import { dirname as __reviewDirname } from "node:path";',
      'import { fileURLToPath as __reviewFileURLToPath } from "node:url";',
      "const require = __reviewCreateRequire(import.meta.url);",
      "const __filename = __reviewFileURLToPath(import.meta.url);",
      "const __dirname = __reviewDirname(__filename);",
    ].join(" "),
  },
});
