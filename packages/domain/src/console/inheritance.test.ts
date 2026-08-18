import { describe, expect, it } from "vitest";

import {
  applyLocationOverride,
  clearLocationOverride,
  resolveInheritedSettings,
} from "./inheritance.js";

const tenantSettings = {
  locale: "en-GB",
  entryMode: "invite",
  requireDisclosure: true,
  maxReviewFormatsPerRequest: 2,
  bannedTerms: ["cure"],
};

describe("ADM-LOC-03 Location inheritance", () => {
  it("reports inheritance when the venue holds no override row", () => {
    const settings = resolveInheritedSettings({
      tenantSettings,
      locationOverrides: {},
    });

    expect(settings.find((row) => row.key === "requireDisclosure")).toMatchObject(
      {
        effectiveValue: true,
        source: "tenant",
        tenantValue: true,
        locationOverride: null,
      },
    );
  });

  it("reports a Location override distinctly from the inherited value", () => {
    const settings = resolveInheritedSettings({
      tenantSettings,
      locationOverrides: { requireDisclosure: false },
    });

    expect(settings.find((row) => row.key === "requireDisclosure")).toMatchObject(
      {
        effectiveValue: false,
        source: "location",
        tenantValue: true,
        locationOverride: false,
      },
    );
  });

  it("still reports an override that happens to equal the Tenant value", () => {
    const settings = resolveInheritedSettings({
      tenantSettings,
      locationOverrides: { requireDisclosure: true },
    });

    expect(settings.find((row) => row.key === "requireDisclosure")).toMatchObject(
      { source: "location", locationOverride: true },
    );
  });

  it("marks Tenant-owned fields that a venue may not override", () => {
    const settings = resolveInheritedSettings({
      tenantSettings,
      locationOverrides: {},
    });

    expect(settings.find((row) => row.key === "locale")?.overridable).toBe(false);
    expect(settings.find((row) => row.key === "entryMode")?.overridable).toBe(
      true,
    );
  });

  it("resets by deleting the override row rather than copying the Tenant value", () => {
    expect(
      applyLocationOverride({
        overrides: {},
        key: "requireDisclosure",
        value: false,
      }),
    ).toEqual({ status: "applied", overrides: { requireDisclosure: false } });

    const reset = clearLocationOverride({
      overrides: { requireDisclosure: false, entryMode: "open-qr" },
      key: "requireDisclosure",
    });

    expect(reset).toEqual({
      status: "applied",
      overrides: { entryMode: "open-qr" },
    });
    if (reset.status !== "applied") {
      throw new Error("reset should apply");
    }
    expect(Object.hasOwn(reset.overrides, "requireDisclosure")).toBe(false);

    // A later Tenant change must reach the venue again.
    expect(
      resolveInheritedSettings({
        tenantSettings: { ...tenantSettings, requireDisclosure: false },
        locationOverrides: reset.overrides,
      }).find((row) => row.key === "requireDisclosure"),
    ).toMatchObject({ effectiveValue: false, source: "tenant" });
  });

  it("refuses to override a field the Location does not own", () => {
    expect(
      applyLocationOverride({ overrides: {}, key: "locale", value: "de-DE" }),
    ).toEqual({ status: "rejected", code: "NOT_OVERRIDABLE" });
    expect(clearLocationOverride({ overrides: {}, key: "locale" })).toEqual({
      status: "rejected",
      code: "NOT_OVERRIDABLE",
    });
  });
});
