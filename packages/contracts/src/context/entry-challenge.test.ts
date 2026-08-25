import { describe, expect, it } from "vitest";

import {
  AdvanceEntryInvocationResultDtoSchema,
  ContextFunctionInvocationDtoSchema,
  EntryChallengeProjectionDtoSchema,
  ReadEntryChallengeInvocationResultDtoSchema,
} from "./index.js";

const publicProjection = {
  status: "ready",
  entryChallengeHandle: "entry-challenge-demo",
  csrfToken: "csrf-token-with-at-least-thirty-two-characters",
  context: {
    tenantDisplayName: "Apex Dental",
    locationDisplayName: "Central Clinic",
    locale: "en-GB",
    entryMode: "invite",
    ratingRequired: true,
    requirements: {
      minimumFactSelections: 1,
      maximumReviewFormatsPerGeneration: 1,
      maximumCustomerAssertionChars: 500,
    },
    factOptions: [],
    reviewFormats: [],
    destinations: [],
  },
} as const;

describe("Entry Challenge projection contract", () => {
  it("accepts the public projection and rejects internal scope identifiers", () => {
    expect([
      EntryChallengeProjectionDtoSchema.safeParse(publicProjection).success,
      EntryChallengeProjectionDtoSchema.safeParse({
        ...publicProjection,
        tenantId: "tenant-apex",
        locationId: "location-central",
      }).success,
    ]).toEqual([true, false]);
  });

  it("carries a pending browser-bound selection through the browser projection", () => {
    expect(
      EntryChallengeProjectionDtoSchema.safeParse({
        ...publicProjection,
        stage: "verification-required",
        provisionalSelection: { rating: 4, action: "generate" },
      }).success,
    ).toBe(true);
  });

  it("lets a browser-bound pending challenge submit opaque verification evidence without scope identity", () => {
    const verification = {
      operation: "verify-entry",
      input: {
        entryChallengeHandle: "entry-challenge-demo",
        browserCapability: "browser-capability-with-at-least-twenty-characters",
        verificationEvidence: "BS-4471-K",
      },
    } as const;

    expect([
      AdvanceEntryInvocationResultDtoSchema.safeParse({
        operation: "advance-entry",
        result: { status: "verification-required" },
      }).success,
      ContextFunctionInvocationDtoSchema.safeParse(verification).success,
      ContextFunctionInvocationDtoSchema.safeParse({
        ...verification,
        input: {
          ...verification.input,
          tenantId: "tenant-apex",
          locationId: "location-central",
        },
      }).success,
    ]).toEqual([true, true, false]);
  });

  it("round-trips a pending selection across refresh and constrains display-only table references", () => {
    const preparedWithTableRef = {
      operation: "prepare-entry",
      input: {
        tenantSlug: "apex-dental",
        locationSlug: "central-clinic",
        invitationToken: "opaque-invitation-token",
        tableRef: "Table 12-A",
        browserCapability: "browser-capability-with-at-least-twenty-characters",
      },
    } as const;

    expect([
      ReadEntryChallengeInvocationResultDtoSchema.safeParse({
        operation: "read-entry-challenge",
        result: {
          status: "ready",
          stage: "verification-required",
          provisionalSelection: { rating: 4, action: "generate" },
          context: publicProjection.context,
        },
      }).success,
      ContextFunctionInvocationDtoSchema.safeParse(preparedWithTableRef).success,
      ContextFunctionInvocationDtoSchema.safeParse({
        ...preparedWithTableRef,
        input: {
          ...preparedWithTableRef.input,
          tableRef: "this-table-reference-is-too-long",
        },
      }).success,
    ]).toEqual([true, true, false]);
  });

  it("accepts an internal immutable Configuration Release pin only as a canonical UUID", () => {
    const prepared = {
      operation: "prepare-entry",
      input: {
        tenantSlug: "apex-dental",
        locationSlug: "central-clinic",
        browserCapability: "browser-capability-with-at-least-twenty-characters",
        configurationReleaseId: "018fd2d8-7f24-4d21-8b10-7dd983cfc487",
      },
    } as const;

    expect([
      ContextFunctionInvocationDtoSchema.safeParse(prepared).success,
      ContextFunctionInvocationDtoSchema.safeParse({
        ...prepared,
        input: { ...prepared.input, configurationReleaseId: "live" },
      }).success,
    ]).toEqual([true, false]);
  });
});
