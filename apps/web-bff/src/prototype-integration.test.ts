import { describe, expect, it } from "vitest";

import { createWebBffApp } from "./app.js";

describe("Web BFF Prototype Integration Suite", () => {
  const app = createWebBffApp();

  it("serves prototype catalog at root GET /", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Assisted review writing");
  });

  it("serves Survey prototype at GET /survey and GET /Survey.dc.html", async () => {
    const res1 = await app.request("/survey");
    expect(res1.status).toBe(200);
    expect(res1.headers.get("content-type")).toContain("text/html");
    const html1 = await res1.text();
    expect(html1).toContain("<x-dc>");
    expect(html1).toContain("SURVEY_STATES");

    const res2 = await app.request("/Survey.dc.html");
    expect(res2.status).toBe(200);
  });

  it("serves Admin prototype at GET /admin and GET /Admin.dc.html", async () => {
    const res1 = await app.request("/admin");
    expect(res1.status).toBe(200);
    expect(res1.headers.get("content-type")).toContain("text/html");
    const html1 = await res1.text();
    expect(html1).toContain("Operator console");

    const res2 = await app.request("/Admin.dc.html");
    expect(res2.status).toBe(200);
  });

  it("serves Gallery prototype at GET /gallery and GET /Gallery.dc.html", async () => {
    const res = await app.request("/gallery");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("serves design system support scripts and styles", async () => {
    const resSupport = await app.request("/support.js");
    expect(resSupport.status).toBe(200);
    expect(resSupport.headers.get("content-type")).toContain("javascript");

    const resDsBase = await app.request("/ds-base.js");
    expect(resDsBase.status).toBe(200);
    expect(resDsBase.headers.get("content-type")).toContain("javascript");

    const resCss = await app.request(
      "/_ds/maue-design-system-961db8e9-ba05-45fc-aa07-f7a7146673b4/styles.css",
    );
    expect(resCss.status).toBe(200);
    expect(resCss.headers.get("content-type")).toContain("css");
  });

  it("routes entry link with text/html accept to Survey prototype", async () => {
    const res = await app.request("/s/brightsmile/harbour-view?v=tok-1&t=Table-1", {
      headers: { Accept: "text/html" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});
