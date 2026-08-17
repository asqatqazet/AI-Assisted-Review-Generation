import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": `http://127.0.0.1:${process.env["REVIEW_LOCAL_BFF_PORT"] ?? "3000"}`,
      "/health": `http://127.0.0.1:${process.env["REVIEW_LOCAL_BFF_PORT"] ?? "3000"}`,
      "^/s/": `http://127.0.0.1:${process.env["REVIEW_LOCAL_BFF_PORT"] ?? "3000"}`,
    },
  },
  build: {
    emptyOutDir: true,
    outDir: "../../dist/apps/web-bff/ui",
  },
});
