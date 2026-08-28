import { describe, expect, it } from "vitest";

import {
  qualifyStudentRelease,
  type StudentReleaseQualificationConsole,
} from "../../scripts/qualify-student-release.js";

const tenantId = "00000000-0000-4000-8000-000000000101";
const promptVersionId = "00000000-0000-4000-8000-000000000136";
const promptVersionHash =
  "sha256:faf385e0cafc00a1b456dbedaa29828486d5fc2f2da8cb16a6debf871ae4fbeb";
const configurationReleaseId = "018fd2d8-7f24-4d21-8b10-7dd983cfc487";
const snapshotId = "00000000-0000-4000-8000-000000000997";

function publishedPayload(promptId = promptVersionId): unknown {
  return {
    settings: {
      locale: "de-DE",
      entryMode: "open-qr",
      requireDisclosure: false,
      requireVerifiedExperience: false,
      maxReviewFormatsPerRequest: 1,
      minimumFactSelections: 1,
      maximumCustomerAssertionChars: 500,
      enabledReviewFormatVersionIds: [
        "00000000-0000-4000-8000-000000000122",
      ],
      enabledCommands: ["generate"],
      monthlyBudgetMicros: 0,
    },
    factOptions: [
      {
        id: "00000000-0000-4000-8000-000000000130",
        active: true,
      },
    ],
    reviewFormats: [
      {
        id: "00000000-0000-4000-8000-000000000122",
        constraints: {
          minChars: 20,
          maxChars: 420,
          paragraphs: 1,
          emojiPolicy: "none",
          secondPerson: false,
        },
        supportedCommands: ["generate"],
      },
    ],
    promptVersions: [
      {
        id: promptId,
        hash: promptVersionHash,
        commandKind: "generate",
      },
    ],
    priceRates: [
      {
        provider: "fake",
        model: "fake-v1",
        inputPerMillionMicros: 0,
        outputPerMillionMicros: 0,
      },
    ],
    providerRouting: {
      primaryProvider: "fake",
      primaryModel: "fake-v1",
    },
  };
}

function consoleBoundary(options?: {
  readonly draftChanges?: readonly unknown[] | null;
  readonly alreadyPublished?: boolean;
  readonly snapshotPayload?: unknown;
}): {
  readonly console: StudentReleaseQualificationConsole;
  readonly calls: string[];
} {
  const calls: string[] = [];
  let draft =
    options?.draftChanges === undefined || options.draftChanges === null
      ? null
      : {
          id: "00000000-0000-4000-8000-000000000999",
          revision: "1",
          baseRevision: "4",
          changes: options.draftChanges,
        };
  let published = options?.alreadyPublished === true;
  let candidateStaged = false;
  return {
    calls,
    console: {
      async listLocations() {
        calls.push("locations");
        return [{ id: "00000000-0000-4000-8000-000000000102" }];
      },
      async readPublishedConfigurationSnapshot(input) {
        calls.push(
          input.configurationReleaseId === undefined
            ? "snapshot:live"
            : "snapshot:candidate",
        );
        return published &&
          (input.configurationReleaseId === undefined || candidateStaged)
          ? {
              snapshotId,
              contentHash: promptVersionHash,
              payload: options?.snapshotPayload ?? publishedPayload(),
            }
          : null;
      },
      async readConfigurationState() {
        calls.push("state");
        return { revision: "4", draft };
      },
      async promotePromptVersion() {
        calls.push("promote");
        return { status: "candidate" };
      },
      async saveConfigurationDraft(input) {
        calls.push("save");
        draft = {
          id: "00000000-0000-4000-8000-000000000998",
          revision: "1",
          baseRevision: input.expectedRevision,
          changes: input.changes,
        };
        return { status: "saved" };
      },
      async publishConfiguration() {
        calls.push("publish");
        published = true;
        candidateStaged = true;
        return {
          status: "published",
          snapshotIds: [snapshotId],
          configurationReleaseId,
        };
      },
      async stageConfigurationRelease(input) {
        calls.push("stage");
        expect(input).toMatchObject({
          tenantId,
          configurationReleaseId,
          snapshotIds: [snapshotId],
        });
        candidateStaged = true;
      },
    },
  };
}

describe("student Prompt release qualification", () => {
  it("rejects an unreviewed student Prompt hash before touching Console state", async () => {
    const { console, calls } = consoleBoundary();

    await expect(
      qualifyStudentRelease({
        console,
        operatorId: "00000000-0000-4000-8000-000000000301",
        tenantId,
        promptVersionId,
        promptVersionHash: `sha256:${"a".repeat(64)}`,
        configurationReleaseId,
      }),
    ).rejects.toThrow("STRICT_ZERO_PROMPT_CONTENT_NOT_APPROVED");
    expect(calls).toEqual([]);
  });

  it("stages and publishes through the production Console seam", async () => {
    const { console, calls } = consoleBoundary();

    const result = await qualifyStudentRelease({
      console,
      operatorId: "00000000-0000-4000-8000-000000000301",
      tenantId,
      promptVersionId,
      promptVersionHash,
      configurationReleaseId,
    });

    expect(result).toEqual({
      status: "published",
      snapshotIds: [snapshotId],
      configurationReleaseId,
    });
    expect(calls).toEqual([
      "locations",
      "snapshot:live",
      "state",
      "promote",
      "save",
      "state",
      "publish",
      "snapshot:candidate",
    ]);
  });

  it("is idempotent when every active Location already reads the exact Prompt", async () => {
    const { console, calls } = consoleBoundary({ alreadyPublished: true });

    await expect(
      qualifyStudentRelease({
        console,
        operatorId: "00000000-0000-4000-8000-000000000301",
        tenantId,
        promptVersionId,
        promptVersionHash,
        configurationReleaseId,
      }),
    ).resolves.toEqual({
      status: "existing",
      snapshotIds: [snapshotId],
      configurationReleaseId,
    });
    expect(calls).toEqual([
      "locations",
      "snapshot:live",
      "promote",
      "stage",
      "snapshot:candidate",
    ]);
  });

  it("does not reuse a stale immutable snapshot that only has the exact Prompt", async () => {
    const { console, calls } = consoleBoundary({
      alreadyPublished: true,
      snapshotPayload: {
        promptVersions: [
          {
            id: promptVersionId,
            hash: promptVersionHash,
            commandKind: "generate",
          },
        ],
      },
    });

    await expect(
      qualifyStudentRelease({
        console,
        operatorId: "00000000-0000-4000-8000-000000000301",
        tenantId,
        promptVersionId,
        promptVersionHash,
        configurationReleaseId,
      }),
    ).resolves.toEqual({
      status: "published",
      snapshotIds: [snapshotId],
      configurationReleaseId,
    });
    expect(calls).toEqual([
      "locations",
      "snapshot:live",
      "state",
      "promote",
      "save",
      "state",
      "publish",
      "snapshot:candidate",
    ]);
  });

  it("fails closed on an unrelated Draft before adding candidacy evidence", async () => {
    const { console, calls } = consoleBoundary({
      draftChanges: [{ key: "locale", value: "en-GB" }],
    });

    await expect(
      qualifyStudentRelease({
        console,
        operatorId: "00000000-0000-4000-8000-000000000301",
        tenantId,
        promptVersionId,
        promptVersionHash,
        configurationReleaseId,
      }),
    ).rejects.toThrow("STUDENT_RELEASE_CONFIGURATION_DRAFT_NOT_EMPTY");
    expect(calls).toEqual(["locations", "snapshot:live", "state"]);
  });
});
