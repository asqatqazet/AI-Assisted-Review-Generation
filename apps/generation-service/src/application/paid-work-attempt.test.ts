import { GenerationWorkloadDtoSchema } from "@review/contracts/generation";
import { describe, expect, it } from "vitest";

import type { ModelGatewayPort } from "../ports/model-gateway.port.js";
import {
  createPaidWorkAttemptPreparer,
  validatePaidWorkTerminalDraft,
  type PaidWorkAttemptInput,
} from "./paid-work-attempt.js";

const workload = GenerationWorkloadDtoSchema.parse({
  bindings: {
    tenantId: "tenant-a",
    locationId: "location-a",
    reviewSessionId: "session-a",
    generationBatchId: "batch-a",
    generationId: "generation-a",
    action: "generate",
    reviewFormatVersionId: "format-a@1",
    assertionSetHash: "sha256:assertions",
    requestHash: "sha256:request",
    snapshotId: "snapshot-a",
    snapshotHash: "sha256:snapshot",
    providerModelId: "provider-model-fake-v1",
    priceRateId: "price-rate-fake-v1",
    idempotencyKey: "request-1",
  },
  snapshot: {
    snapshotId: "snapshot-a",
    schemaVersion: 2,
    tenantId: "tenant-a",
    locationId: "location-a",
    tenantName: "Brightsmile Dental",
    locationName: "Downtown Clinic",
    settings: {
      locale: "en-GB",
      toneGuidelines: "Warm and specific.",
      entryMode: "invite",
      requireDisclosure: false,
      requireVerifiedExperience: false,
      maxReviewFormatsPerRequest: 1,
      minimumFactSelections: 1,
      maximumCustomerAssertionChars: 500,
      bannedTerms: ["guaranteed"],
      enabledReviewFormatVersionIds: ["format-a@1"],
      enabledCommands: ["generate"],
      monthlyBudgetMicros: 1_000_000,
      alertThresholdPct: 80,
    },
    provenance: {},
    factOptions: [],
    reviewFormats: [
      {
        id: "format-a@1",
        key: "concise-blurb",
        version: "1.0.0",
        displayName: "Concise blurb",
        targetPlatform: "google",
        locale: "any",
        description: { "en-GB": "One concise paragraph." },
        sample: { "en-GB": "A clear explanation." },
        constraints: {
          minChars: 20,
          maxChars: 350,
          paragraphs: 1,
          emojiPolicy: "none",
          secondPerson: false,
        },
        supportedCommands: ["generate"],
      },
    ],
    promptVersions: [
      {
        id: "prompt-version-generate-v1",
        hash: `sha256:${"a".repeat(64)}`,
        key: "review.generate",
        commandKind: "generate",
        body: "Use only the reviewer-confirmed Assertions.",
        variables: ["locale", "tone"],
      },
    ],
    priceRates: [
      {
        id: "price-rate-fake-v1",
        providerModelId: "provider-model-fake-v1",
        provider: "fake",
        model: "fake-v1",
        inputPerMillionMicros: 0,
        outputPerMillionMicros: 0,
        currency: "EUR",
        unit: "token",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        effectiveTo: null,
      },
    ],
    providerRouting: {
      version: "routing-v1",
      providerModelId: "provider-model-fake-v1",
      primaryProvider: "fake",
      primaryModel: "fake-v1",
    },
  },
  command: {
    kind: "generate",
    assertionIds: ["assertion-a"],
    rating: 5,
  },
  assertions: [
    {
      id: "assertion-a",
      version: "assertion-a@1",
      reviewSessionId: "session-a",
      semanticId: "service-explained-clearly",
      proposition: "The treatment was explained well.",
      semanticKind: "experience-fact",
      polarity: "positive",
      source: {
        kind: "reviewer-text",
        sourceRevisionId: "source-revision-a",
        start: 0,
        end: 30,
        quotedText: "The treatment was explained well.",
      },
    },
  ],
});

const paraphraseWorkload = (
  assertions: readonly unknown[] = workload.assertions,
) =>
  GenerationWorkloadDtoSchema.parse({
    ...workload,
    bindings: {
      ...workload.bindings,
      action: "paraphrase",
    },
    snapshot: {
      ...workload.snapshot,
      settings: {
        ...workload.snapshot.settings,
        enabledCommands: ["paraphrase"],
      },
      reviewFormats: [
        {
          ...workload.snapshot.reviewFormats[0]!,
          supportedCommands: ["paraphrase"],
        },
      ],
      promptVersions: [
        {
          id: "prompt-version-paraphrase-v1",
          hash: `sha256:${"b".repeat(64)}`,
          key: "review.paraphrase",
          commandKind: "paraphrase",
          body: "Paraphrase only the immutable reviewer-source Assertions.",
          variables: ["locale", "tone"],
        },
      ],
    },
    command: {
      kind: "paraphrase",
      sourceTextRevisionId: "source-revision-a",
    },
    assertions,
  });

describe("US-03.2 paid-work Attempt preparation", () => {
  it("prepares the exact provider request without entering the provider", async () => {
    let providerCalls = 0;
    const gateway: ModelGatewayPort = {
      generate: async () => {
        providerCalls += 1;
        throw new Error("provider must not run while the request is prepared");
      },
    };

    const prepareAttempt = createPaidWorkAttemptPreparer({ gateway });
    const prepared = await prepareAttempt(workload);

    expect(prepared.requestPayload).toMatchObject({
      model: "fake-v1",
      maxOutputTokens: 350,
      messages: [
        {
          role: "system",
          content: expect.stringContaining("Use only the reviewer-confirmed Assertions."),
        },
        {
          role: "user",
          content:
            "Assertions:\n- [assertion-a] The treatment was explained well.",
        },
      ],
      outputSchema: { name: "CandidateGeneration" },
    });
    expect(providerCalls).toBe(0);
  });

  it("prepares Paraphrase only from Assertions anchored to the immutable source revision", async () => {
    let providerCalls = 0;
    const gateway: ModelGatewayPort = {
      generate: async () => {
        providerCalls += 1;
        throw new Error("provider must not run while the request is prepared");
      },
    };
    const prepared = await createPaidWorkAttemptPreparer({ gateway })(
      paraphraseWorkload(),
    );

    expect(prepared.requestPayload.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content:
            "Source Assertions (immutable reviewer text):\n- [assertion-a] The treatment was explained well.",
        }),
      ]),
    );
    expect(JSON.stringify(prepared.requestPayload)).not.toContain(
      "Source draft",
    );
    expect(providerCalls).toBe(0);
  });

  it("rejects a Paraphrase proposition that is not the immutable quoted span before paid work", async () => {
    let providerCalls = 0;
    const gateway: ModelGatewayPort = {
      generate: async () => {
        providerCalls += 1;
        throw new Error("provider must not run for unresolved source evidence");
      },
    };
    const laundered = paraphraseWorkload([
      {
        ...workload.assertions[0]!,
        proposition: "Parking was free.",
      },
    ]);

    const rejected = await createPaidWorkAttemptPreparer({ gateway })(
      laundered,
    ).catch((error: unknown) => error);

    expect(rejected).toMatchObject({
      code: "ACTION_SOURCE_EVIDENCE_NOT_RESOLVED",
    });
    expect(JSON.stringify(rejected)).not.toContain("Parking was free");
    expect(providerCalls).toBe(0);
  });

  it.each([
    ["resample", { kind: "resample", sourceGenerationId: "source-a" }],
    ["reformat", { kind: "reformat", sourceGenerationId: "source-a" }],
    [
      "condense",
      {
        kind: "condense",
        sourceGenerationId: "source-a",
        targetMaxChars: 120,
      },
    ],
    [
      "expand",
      {
        kind: "expand",
        sourceGenerationId: "source-a",
        targetMinChars: 220,
      },
    ],
    [
      "revise-wording",
      {
        kind: "revise-wording",
        sourceGenerationId: "source-a",
        presentationInstruction: "Make it warmer.",
      },
    ],
  ] as const)(
    "fails %s closed before paid work while source Generation evidence is unresolved",
    async (action, command) => {
      let providerCalls = 0;
      const gateway: ModelGatewayPort = {
        generate: async () => {
          providerCalls += 1;
          throw new Error("provider must not run for unresolved source evidence");
        },
      };
      const unresolved = GenerationWorkloadDtoSchema.parse({
        ...workload,
        bindings: { ...workload.bindings, action },
        command,
      });

      const rejected = await createPaidWorkAttemptPreparer({ gateway })(
        unresolved,
      ).catch((error: unknown) => error);

      expect(rejected).toMatchObject({
        code: "ACTION_SOURCE_EVIDENCE_NOT_RESOLVED",
      });
      expect(providerCalls).toBe(0);
    },
  );

  it("fails closed when second-person policy cannot be evaluated for the locale", () => {
    const unsupportedLocaleWorkload = {
      ...workload,
      snapshot: {
        ...workload.snapshot,
        settings: {
          ...workload.snapshot.settings,
          locale: "fr-FR",
        },
      },
    } as unknown as PaidWorkAttemptInput;
    const claim = {
      id: "claim-a",
      semanticId: "service-explained-clearly",
      semanticKind: "experience-fact" as const,
      polarity: "positive" as const,
      text: "The treatment was explained well.",
      grounding: [
        {
          kind: "assertion" as const,
          assertionId: "assertion-a",
          assertionVersion: "assertion-a@1",
        },
      ],
    };

    expect(
      validatePaidWorkTerminalDraft(unsupportedLocaleWorkload, {
        draft: claim.text,
        draftBody: claim.text,
        systemAnnotations: [],
        claims: [claim],
      }),
    ).toEqual({ verdict: "rejected", code: "FORMAT_REJECTED" });
  });

  it("enforces the Review Format minimum against the exact terminal Draft", () => {
    const minimumWorkload = {
      ...workload,
      snapshot: {
        ...workload.snapshot,
        reviewFormats: [
          {
            ...workload.snapshot.reviewFormats[0]!,
            constraints: {
              ...workload.snapshot.reviewFormats[0]!.constraints,
              minChars: 100,
              maxChars: 1_000,
            },
          },
        ],
      },
    };
    const claim = {
      id: "claim-a",
      semanticId: "service-explained-clearly",
      semanticKind: "experience-fact" as const,
      polarity: "positive" as const,
      text: "The treatment was explained well.",
      grounding: [
        {
          kind: "assertion" as const,
          assertionId: "assertion-a",
          assertionVersion: "assertion-a@1",
        },
      ],
    };

    expect(
      validatePaidWorkTerminalDraft(minimumWorkload, {
        draft: claim.text,
        draftBody: claim.text,
        systemAnnotations: [],
        claims: [claim],
      }),
    ).toEqual({ verdict: "rejected", code: "FORMAT_REJECTED" });
  });

  it("rejects an ungrounded candidate without exposing its bytes", async () => {
    const gateway: ModelGatewayPort = {
      generate: async () => ({
        output: {
          draft: "The clinic gave me a free upgrade.",
          claims: [
            {
              id: "claim-unsupported",
              text: "The clinic gave me a free upgrade.",
              assertionIds: ["assertion-not-supplied"],
            },
          ],
        },
        attempt: {
          provider: "fake",
          model: "fake-v1",
          usage: { inputTokens: 20, outputTokens: 9 },
          receipt: { requestId: "provider-request-a", finishReason: "stop" },
        },
      }),
    };

    const prepared = await createPaidWorkAttemptPreparer({ gateway })(workload);
    const rejected = await prepared.execute("attempt-a");

    expect(rejected).toMatchObject({
      status: "rejected",
      code: "GROUNDING_REJECTED",
      providerOutput: { draft: "The clinic gave me a free upgrade." },
      attempt: { receipt: { requestId: "provider-request-a" } },
    });
  });

  it("rejects grounded wording that violates the resolved policy", async () => {
    const gateway: ModelGatewayPort = {
      generate: async () => ({
        output: {
          draft: "The treatment was guaranteed.",
          claims: [
            {
              id: "claim-a",
              text: "The treatment was guaranteed.",
              assertionIds: ["assertion-a"],
            },
          ],
        },
        attempt: {
          provider: "fake",
          model: "fake-v1",
          usage: { inputTokens: 20, outputTokens: 9 },
          receipt: { requestId: "provider-request-b", finishReason: "stop" },
        },
      }),
    };

    const policyWorkload = {
      ...workload,
      assertions: [
        {
          ...workload.assertions[0]!,
          proposition: "The treatment was guaranteed.",
        },
      ],
    };
    const prepared = await createPaidWorkAttemptPreparer({ gateway })(
      policyWorkload,
    );
    const rejected = await prepared.execute("attempt-b");

    expect(rejected).toMatchObject({
      status: "rejected",
      code: "POLICY_REJECTED",
      providerOutput: { draft: "The treatment was guaranteed." },
    });
  });

  it("does not let a real Assertion id launder an unsupported proposition", async () => {
    const gateway: ModelGatewayPort = {
      generate: async () => ({
        output: {
          draft: "The clinic gave me a free upgrade.",
          claims: [
            {
              id: "claim-laundered",
              text: "The clinic gave me a free upgrade.",
              assertionIds: ["assertion-a"],
            },
          ],
        },
        attempt: {
          provider: "fake",
          model: "fake-v1",
          usage: { inputTokens: 20, outputTokens: 9 },
          receipt: { requestId: "provider-request-c", finishReason: "stop" },
        },
      }),
    };

    const prepared = await createPaidWorkAttemptPreparer({ gateway })(workload);
    const rejected = await prepared.execute("attempt-c");

    expect(rejected).toMatchObject({
      status: "rejected",
      code: "GROUNDING_REJECTED",
      providerOutput: { draft: "The clinic gave me a free upgrade." },
    });
  });

  it("rejects a grounded Draft outside the selected Review Format", async () => {
    const gateway: ModelGatewayPort = {
      generate: async () => ({
        output: {
          draft: "The treatment was explained well.",
          claims: [
            {
              id: "claim-a",
              text: "The treatment was explained well.",
              assertionIds: ["assertion-a"],
            },
          ],
        },
        attempt: {
          provider: "fake",
          model: "fake-v1",
          usage: { inputTokens: 20, outputTokens: 8 },
          receipt: { requestId: "provider-request-d", finishReason: "stop" },
        },
      }),
    };
    const formatWorkload = {
      ...workload,
      snapshot: {
        ...workload.snapshot,
        reviewFormats: [
          {
            ...workload.snapshot.reviewFormats[0]!,
            constraints: {
              ...workload.snapshot.reviewFormats[0]!.constraints,
              minChars: 0,
              maxChars: 10,
            },
          },
        ],
      },
    };

    const prepared = await createPaidWorkAttemptPreparer({ gateway })(
      formatWorkload,
    );
    const rejected = await prepared.execute("attempt-d");

    expect(rejected).toMatchObject({
      status: "rejected",
      code: "FORMAT_REJECTED",
      providerOutput: { draft: "The treatment was explained well." },
    });
  });

  it("validates paragraph count against the exact post-disclosure Draft", async () => {
    const gateway: ModelGatewayPort = {
      generate: async () => ({
        output: {
          draft: "The treatment was explained well.",
          claims: [
            {
              id: "claim-a",
              text: "The treatment was explained well.",
              assertionIds: ["assertion-a"],
            },
          ],
        },
        attempt: {
          provider: "fake",
          model: "fake-v1",
          usage: { inputTokens: 20, outputTokens: 8 },
          receipt: { requestId: "provider-request-disclosure", finishReason: "stop" },
        },
      }),
    };
    const disclosureWorkload = {
      ...workload,
      snapshot: {
        ...workload.snapshot,
        provenance: {
          requireDisclosure: {
            scope: "tenant" as const,
            sourceId: "tenant-a",
            revision: "tenant-policy-r7",
          },
        },
        settings: {
          ...workload.snapshot.settings,
          requireDisclosure: true,
        },
        reviewFormats: [
          {
            ...workload.snapshot.reviewFormats[0]!,
            constraints: {
              ...workload.snapshot.reviewFormats[0]!.constraints,
              minChars: 0,
              maxChars: 1_000,
              paragraphs: 1,
            },
          },
        ],
      },
    };

    const prepared = await createPaidWorkAttemptPreparer({ gateway })(
      disclosureWorkload,
    );
    const rejected = await prepared.execute("attempt-disclosure");

    expect(rejected).toMatchObject({
      status: "rejected",
      code: "FORMAT_REJECTED",
      providerOutput: { draft: "The treatment was explained well." },
    });
  });

  it("rejects emoji in the final Draft when the Review Format forbids it", async () => {
    const emojiText = "The treatment was explained well ✨";
    const gateway: ModelGatewayPort = {
      generate: async () => ({
        output: {
          draft: emojiText,
          claims: [
            {
              id: "claim-a",
              text: emojiText,
              assertionIds: ["assertion-a"],
            },
          ],
        },
        attempt: {
          provider: "fake",
          model: "fake-v1",
          usage: { inputTokens: 20, outputTokens: 8 },
          receipt: { requestId: "provider-request-emoji", finishReason: "stop" },
        },
      }),
    };
    const emojiWorkload = {
      ...workload,
      assertions: [
        {
          ...workload.assertions[0]!,
          proposition: emojiText,
          source: {
            ...workload.assertions[0]!.source,
            quotedText: emojiText,
          },
        },
      ],
    };

    const prepared = await createPaidWorkAttemptPreparer({ gateway })(
      emojiWorkload,
    );
    const rejected = await prepared.execute("attempt-emoji");

    expect(rejected).toMatchObject({
      status: "rejected",
      code: "FORMAT_REJECTED",
      providerOutput: { draft: emojiText },
    });
  });

  it.each([
    ["en-GB", "You explained the treatment well."],
    ["de-DE", "Du hast die Behandlung gut erklärt."],
  ] as const)(
    "rejects %s second-person wording when the Review Format forbids it",
    async (locale, secondPersonText) => {
    const gateway: ModelGatewayPort = {
      generate: async () => ({
        output: {
          draft: secondPersonText,
          claims: [
            {
              id: "claim-a",
              text: secondPersonText,
              assertionIds: ["assertion-a"],
            },
          ],
        },
        attempt: {
          provider: "fake",
          model: "fake-v1",
          usage: { inputTokens: 20, outputTokens: 8 },
          receipt: {
            requestId: "provider-request-second-person",
            finishReason: "stop",
          },
        },
      }),
    };
    const secondPersonWorkload = {
      ...workload,
      snapshot: {
        ...workload.snapshot,
        settings: { ...workload.snapshot.settings, locale },
      },
      assertions: [
        {
          ...workload.assertions[0]!,
          proposition: secondPersonText,
          source: {
            ...workload.assertions[0]!.source,
            quotedText: secondPersonText,
          },
        },
      ],
    };

    const prepared = await createPaidWorkAttemptPreparer({ gateway })(
      secondPersonWorkload,
    );
    const rejected = await prepared.execute("attempt-second-person");

    expect(rejected).toMatchObject({
      status: "rejected",
      code: "FORMAT_REJECTED",
      providerOutput: { draft: secondPersonText },
    });
    },
  );

  it("applies banned terms to system-authored disclosure text too", async () => {
    const gateway: ModelGatewayPort = {
      generate: async () => ({
        output: {
          draft: "The treatment was explained well.",
          claims: [
            {
              id: "claim-a",
              text: "The treatment was explained well.",
              assertionIds: ["assertion-a"],
            },
          ],
        },
        attempt: {
          provider: "fake",
          model: "fake-v1",
          usage: { inputTokens: 20, outputTokens: 8 },
          receipt: {
            requestId: "provider-request-disclosure-policy",
            finishReason: "stop",
          },
        },
      }),
    };
    const policyWorkload = {
      ...workload,
      snapshot: {
        ...workload.snapshot,
        tenantName: "Guaranteed Dental",
        provenance: {
          requireDisclosure: {
            scope: "tenant" as const,
            sourceId: "tenant-a",
            revision: "tenant-policy-r7",
          },
        },
        settings: {
          ...workload.snapshot.settings,
          requireDisclosure: true,
          bannedTerms: ["guaranteed"],
        },
        reviewFormats: [
          {
            ...workload.snapshot.reviewFormats[0]!,
            constraints: {
              ...workload.snapshot.reviewFormats[0]!.constraints,
              minChars: 0,
              maxChars: 1_000,
              paragraphs: 2,
            },
          },
        ],
      },
    };

    const prepared = await createPaidWorkAttemptPreparer({ gateway })(
      policyWorkload,
    );
    const rejected = await prepared.execute("attempt-disclosure-policy");

    expect(rejected).toMatchObject({
      status: "rejected",
      code: "POLICY_REJECTED",
      providerOutput: { draft: "The treatment was explained well." },
    });
  });

  it("keeps disclosure as typed system annotation provenance beside the Claim-covered body", async () => {
    const gateway: ModelGatewayPort = {
      generate: async () => ({
        output: {
          draft: "The treatment was explained well.",
          claims: [
            {
              id: "claim-a",
              text: "The treatment was explained well.",
              assertionIds: ["assertion-a"],
            },
          ],
        },
        attempt: {
          provider: "fake",
          model: "fake-v1",
          usage: { inputTokens: 20, outputTokens: 8 },
          receipt: {
            requestId: "provider-request-typed-disclosure",
            finishReason: "stop",
          },
        },
      }),
    };
    const disclosureWorkload = {
      ...workload,
      snapshot: {
        ...workload.snapshot,
        provenance: {
          requireDisclosure: {
            scope: "tenant" as const,
            sourceId: "tenant-a",
            revision: "tenant-policy-r7",
          },
        },
        settings: {
          ...workload.snapshot.settings,
          requireDisclosure: true,
        },
        reviewFormats: [
          {
            ...workload.snapshot.reviewFormats[0]!,
            constraints: {
              ...workload.snapshot.reviewFormats[0]!.constraints,
              minChars: 0,
              maxChars: 1_000,
              paragraphs: 2,
            },
          },
        ],
      },
    };

    const prepared = await createPaidWorkAttemptPreparer({ gateway })(
      disclosureWorkload,
    );

    const result = await prepared.execute("attempt-typed-disclosure");
    expect(result).toMatchObject({
      providerOutput: {
        draft: "The treatment was explained well.",
        claims: [
          {
            id: "claim-a",
            text: "The treatment was explained well.",
            assertionIds: ["assertion-a"],
          },
        ],
      },
      draftBody: "The treatment was explained well.",
      draft:
        "The treatment was explained well.\n\nReview generated with AI assistance on behalf of Brightsmile Dental.",
      systemAnnotations: [
        {
          kind: "assisted-review-disclosure",
          text: "Review generated with AI assistance on behalf of Brightsmile Dental.",
          policyVersionId: "tenant-policy-r7",
        },
      ],
      claims: [{ text: "The treatment was explained well." }],
    });
    expect(result.providerOutput).not.toHaveProperty("requestId");
  });
});
