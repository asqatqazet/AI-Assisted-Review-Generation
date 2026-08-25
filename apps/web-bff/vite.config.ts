import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: {
    __RELEASE_SHA__: JSON.stringify(
      process.env["REVIEW_RELEASE_SHA"] ?? process.env["GITHUB_SHA"] ?? "local",
    ),
  },
  server: {
    proxy: {
      "/api": `http://127.0.0.1:${process.env["REVIEW_LOCAL_BFF_PORT"] ?? "3000"}`,
      "/auth": `http://127.0.0.1:${process.env["REVIEW_LOCAL_BFF_PORT"] ?? "3000"}`,
      "/health": `http://127.0.0.1:${process.env["REVIEW_LOCAL_BFF_PORT"] ?? "3000"}`,
      "^/s/": `http://127.0.0.1:${process.env["REVIEW_LOCAL_BFF_PORT"] ?? "3000"}`,
    },
  },
  build: {
    emptyOutDir: true,
    outDir: "../../dist/apps/web-bff/ui",
  },
});
