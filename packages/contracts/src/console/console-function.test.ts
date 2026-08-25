import { describe, expect, it } from "vitest";

import {
  ConsoleCommandDtoSchema,
  ConsoleRequestInvocationDtoSchema,
} from "./console-function.js";
import { ConsolePromptVersionDtoSchema } from "./ai.js";
import { ConsoleConfigurationDraftChangeDtoSchema } from "./configuration-draft.js";
import { PlatformProvidersDtoSchema } from "./platform.js";

describe("US-04.2 typed configuration commands", () => {
  it("accepts only values valid for the named Tenant setting", () => {
    expect(
      ConsoleCommandDtoSchema.safeParse({
        command: "save-tenant-settings",
        changes: [
          { key: "locale", value: "de-DE" },
          { key: "maxReviewFormatsPerRequest", value: 3 },
          { key: "alertThresholdPct", value: 85 },
        ],
      }).success,
    ).toBe(true);

    for (const invalid of [
      { key: "locale", value: "fr-FR" },
      { key: "maxReviewFormatsPerRequest", value: Number.NaN },
      { key: "maxReviewFormatsPerRequest", value: 9 },
      { key: "alertThresholdPct", value: 101 },
      { key: "monthlyBudgetMicros", value: -1 },
    ]) {
      expect(
        ConsoleCommandDtoSchema.safeParse({
          command: "save-tenant-settings",
          changes: [invalid],
        }).success,
      ).toBe(false);
    }
  });

  it("accepts only an allow-listed, correctly typed Location override", () => {
    expect(
      ConsoleCommandDtoSchema.safeParse({
        command: "set-location-override",
        change: { key: "requireDisclosure", value: false },
      }).success,
    ).toBe(true);

    expect(
      ConsoleCommandDtoSchema.safeParse({
        command: "set-location-override",
        change: { key: "requireDisclosure", value: "false" },
      }).success,
    ).toBe(false);
    expect(
      ConsoleCommandDtoSchema.safeParse({
        command: "set-location-override",
        change: { key: "monthlyBudgetMicros", value: 100 },
      }).success,
    ).toBe(false);
  });

  it("accepts an explicit Prompt promotion command", () => {
    expect(
      ConsoleCommandDtoSchema.safeParse({
        command: "promote-prompt-version",
        promptVersionId: "prompt-generate-3",
      }).success,
    ).toBe(true);
  });

  it("exposes only canonical content hashes for Prompt Versions", () => {
    const prompt = {
      id: "prompt-generate-3",
      action: "generate",
      version: 3,
      status: "published",
      createdAt: "2026-08-23T12:00:00.000Z",
      createdBy: "operator-1",
      evaluationScore: null,
    } as const;

    expect(
      ConsolePromptVersionDtoSchema.safeParse({
        ...prompt,
        hash: `sha256:${"a".repeat(64)}`,
      }).success,
    ).toBe(true);
    expect(
      ConsolePromptVersionDtoSchema.safeParse({
        ...prompt,
        hash: "sha256:not-a-canonical-digest",
      }).success,
    ).toBe(false);
  });

  it("carries If-Match separately from Draft, cancel and publish commands", () => {
    const base = {
      operation: "console-request",
      input: {
        identity: {
          issuer: "https://issuer.example.test",
          subject: "operator-1",
          email: "operator@example.test",
        },
        scope: { tenantId: "tenant-a", locationId: null },
        publicOrigin: "https://review.example.test",
        ifMatch: '"tenant:tenant-a:7"',
      },
    } as const;

    for (const command of [
      { command: "cancel-configuration-draft" },
      { command: "publish-configuration" },
    ]) {
      expect(
        ConsoleRequestInvocationDtoSchema.safeParse({
          ...base,
          input: {
            ...base.input,
            request: { mode: "command", command },
          },
        }).success,
      ).toBe(true);
    }
  });
});

describe("Platform Configuration Draft contract", () => {
  const settingsChange = {
    operation: "save-platform-settings",
    defaultPolicyTemplate: "{}",
    globalRateLimits: {
      perReviewSessionPerHour: 20,
      perTenantPerMinute: 60,
      maxConcurrentGenerations: 4,
    },
    logRetentionDays: 30,
    featureFlags: [],
  } as const;

  it("keeps Platform changes out of the Tenant Configuration Draft union", () => {
    expect(
      ConsoleConfigurationDraftChangeDtoSchema.safeParse(settingsChange).success,
    ).toBe(false);
    expect(
      ConsoleCommandDtoSchema.safeParse({
        command: "stage-platform-configuration-changes",
        changes: [settingsChange],
      }).success,
    ).toBe(true);
  });

  it("carries If-Match for Platform stage, cancel and publish", () => {
    const base = {
      operation: "console-request",
      input: {
        identity: {
          issuer: "https://issuer.example.test",
          subject: "operator-1",
          email: "operator@example.test",
        },
        scope: { tenantId: null, locationId: null },
        publicOrigin: "https://review.example.test",
        ifMatch: '"platform-configuration:7:draft:none"',
      },
    } as const;
    for (const command of [
      { command: "stage-platform-configuration-changes", changes: [settingsChange] },
      { command: "cancel-platform-configuration-draft" },
      { command: "publish-platform-configuration" },
    ]) {
      expect(
        ConsoleRequestInvocationDtoSchema.safeParse({
          ...base,
          input: { ...base.input, request: { mode: "command", command } },
        }).success,
      ).toBe(true);
    }
  });

  it("requires Platform views to return the shared opaque Draft ETag", () => {
    const data = {
      scope: "platform",
      configuration: {
        etag: '"platform-configuration:7:draft:abc:2"',
        draft: { baseEtag: '"platform-configuration:7:draft:none"', changes: [settingsChange] },
      },
      models: [],
      priceVersions: [],
    } as const;
    expect(PlatformProvidersDtoSchema.safeParse(data).success).toBe(true);
    const withoutEtag = {
      scope: data.scope,
      models: data.models,
      priceVersions: data.priceVersions,
    };
    expect(PlatformProvidersDtoSchema.safeParse(withoutEtag).success).toBe(false);
  });
});
