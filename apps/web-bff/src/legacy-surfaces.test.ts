import { describe, expect, it } from "vitest";

import { createWebBffApp } from "./app.js";

describe("production BFF surface", () => {
  it("does not publish prototype and fixture-runtime routes", async () => {
    const app = createWebBffApp();
    const paths = [
      "/survey",
      "/admin",
      "/gallery",
      "/marketing",
      "/Survey.dc.html",
      "/support.js",
      "/ds-base.js",
      "/_ds/maue-design-system/styles.css",
    ];

    const statuses = await Promise.all(
      paths.map(async (path) => (await app.request(path)).status),
    );

    expect(statuses).toEqual(paths.map(() => 404));
  });
});
