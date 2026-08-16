import { describe, expect, it } from "vitest";

import { createContextServiceApp, createInMemoryContextStore } from "./app.js";

describe("TS-15 Context Service Control Plane", () => {
  it("serves resolved config snapshot with strong ETag and 304 on If-None-Match", async () => {
    const store = createInMemoryContextStore();
    const app = createContextServiceApp({ store });

    // 1. Initial GET
    const res1 = await app.request("/context/tenant-a/location-a");
    expect(res1.status).toBe(200);

    const etag = res1.headers.get("ETag");
    expect(etag).toBeDefined();
    expect(etag?.startsWith('"sha256:')).toBe(true);

    const snapshot = await res1.json();
    expect(snapshot.snapshotId).toBeDefined();
    expect(snapshot.tenantId).toBe("tenant-a");
    expect(snapshot.locationId).toBe("location-a");
    expect(snapshot.providerRouting).toMatchObject({
      primaryProvider: "gemini",
      primaryModel: "gemini-3.5-flash-lite",
    });

    // 2. Stable ETag on identical subsequent read
    const res2 = await app.request("/context/tenant-a/location-a");
    expect(res2.status).toBe(200);
    expect(res2.headers.get("ETag")).toBe(etag);

    // 3. Conditional GET with matching If-None-Match yields 304 Not Modified
    const res3 = await app.request("/context/tenant-a/location-a", {
      headers: {
        "If-None-Match": etag!,
      },
    });
    expect(res3.status).toBe(304);
  });

  it("updates tenant settings, increments revision, and updates snapshot ETag", async () => {
    const store = createInMemoryContextStore();
    const app = createContextServiceApp({ store });

    const initialRes = await app.request("/context/tenant-a/location-a");
    const initialEtag = initialRes.headers.get("ETag");

    // Update tenant settings as tenant_admin
    const updateRes = await app.request("/admin/tenants/tenant-a/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "tenant_admin",
        "x-tenant-id": "tenant-a",
      },
      body: JSON.stringify({
        toneGuidelines: "Friendly and bubbly.",
      }),
    });
    expect(updateRes.status).toBe(200);

    // Read new snapshot
    const updatedRes = await app.request("/context/tenant-a/location-a");
    expect(updatedRes.status).toBe(200);

    const updatedSnapshot = await updatedRes.json();
    expect(updatedSnapshot.settings.toneGuidelines).toBe("Friendly and bubbly.");

    const newEtag = updatedRes.headers.get("ETag");
    expect(newEtag).not.toBe(initialEtag);
  });

  it("rejects unauthorized write on scopes the caller cannot hold", async () => {
    const store = createInMemoryContextStore();
    const app = createContextServiceApp({ store });

    // Attempting platform write as location_manager
    const res = await app.request("/admin/platform/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "location_manager",
      },
      body: JSON.stringify({
        locale: "de-DE",
      }),
    });

    expect(res.status).toBe(403);
  });

  it("provisions new tenant with empty keywords so survey renders not-configured", async () => {
    const store = createInMemoryContextStore();
    const app = createContextServiceApp({ store });

    const provRes = await app.request("/admin/tenants/provision", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "platform_admin",
      },
      body: JSON.stringify({
        tenantId: "tenant-fresh",
        tenantName: "Fresh Clinic",
        locationId: "loc-fresh-1",
        locationName: "Downtown",
      }),
    });

    expect(provRes.status).toBe(201);

    const snapshotRes = await app.request("/context/tenant-fresh/loc-fresh-1");
    expect(snapshotRes.status).toBe(200);

    const snapshot = await snapshotRes.json();
    expect(snapshot.factOptions).toEqual([]);
    expect(snapshot.tenantName).toBe("Fresh Clinic");
  });
});
