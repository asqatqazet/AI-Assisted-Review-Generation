import { createHash } from "node:crypto";

import {
  type AuthorizeConsoleBenchInvocationDto,
  type AuthorizeConsoleBenchInvocationResultDto,
} from "@review/contracts/console";
import {
  GenerationWorkloadDtoSchema,
  type GenerationAssertionDto,
  type GenerationWorkloadDto,
} from "@review/contracts/generation";
import { EffectiveConfigurationSnapshotDtoSchema } from "@review/contracts/shared";
import { deriveConfigSnapshotId } from "@review/domain/configuration";
import { isExecutableGenerationAction } from "@review/domain/generation";
import type {
  OperatorAccessProjectionDto,
  OperatorIdentityDto,
} from "@review/contracts/context";

import { COMMAND_POLICIES, resolveConsoleScope } from "./scope.js";
import type { ConsoleControlPlaneStoreFactory } from "./store.port.js";

type Result = AuthorizeConsoleBenchInvocationResultDto["result"];

export interface ConsoleBenchAuthority {
  signBench(input: {
    readonly workload: GenerationWorkloadDto;
    readonly isBench: true;
    readonly expiresAt: string;
  }): string;
}

export interface ConsoleBenchAuthorizer {
  authorize(
    input: AuthorizeConsoleBenchInvocationDto["input"],
  ): Promise<Result>;
}

const NOT_FOUND: Result = { status: "not-found" };

const hashJson = (value: unknown): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

function ownsFactOption(
  fact: {
    readonly owner:
      | { readonly scope: "tenant"; readonly tenantId: string }
      | {
          readonly scope: "location";
          readonly tenantId: string;
          readonly locationId: string;
        };
  },
  tenantId: string,
  locationId: string,
): boolean {
  return (
    fact.owner.tenantId === tenantId &&
    (fact.owner.scope === "tenant" || fact.owner.locationId === locationId)
  );
}

export function createConsoleBenchAuthorizer({
  store,
  authority,
  resolveAccess,
  now = () => new Date(),
  newId = () => globalThis.crypto.randomUUID(),
  receiptTtlMs = 30_000,
}: {
  readonly store: ConsoleControlPlaneStoreFactory;
  readonly authority: ConsoleBenchAuthority;
  readonly resolveAccess: (
    identity: OperatorIdentityDto,
  ) => Promise<OperatorAccessProjectionDto>;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
  readonly receiptTtlMs?: number | undefined;
}): ConsoleBenchAuthorizer {
  return {
    async authorize(input) {
      const access = await resolveAccess(input.identity);
      if (access.status !== "authorized") {
        return NOT_FOUND;
      }
      const scopedStore = store.forOperator(access.operator.id);
      const scope = await resolveConsoleScope({
        access,
        request: input.scope,
        policy: COMMAND_POLICIES["run-bench"],
        store: scopedStore,
      });
      // Bench always evaluates one venue's effective configuration. A Tenant
      // alone has no single published snapshot to execute.
      if (
        scope.status !== "resolved" ||
        scope.tenantId === null ||
        scope.locationId === null
      ) {
        return NOT_FOUND;
      }

      const published = await scopedStore.readPublishedConfigurationSnapshot({
        tenantId: scope.tenantId,
        locationId: scope.locationId,
      });
      if (published === null) {
        return NOT_FOUND;
      }
      const parsedSnapshot = EffectiveConfigurationSnapshotDtoSchema.safeParse(
        published.payload,
      );
      if (!parsedSnapshot.success) {
        return NOT_FOUND;
      }
      const snapshot = parsedSnapshot.data;
      if (
        deriveConfigSnapshotId(snapshot) !== published.contentHash ||
        snapshot.tenantId !== scope.tenantId ||
        snapshot.locationId !== scope.locationId ||
        snapshot.providerRouting.primaryProvider !== "fake" ||
        snapshot.providerRouting.primaryModel !== "fake-v1" ||
        input.input.provider !== "fake"
      ) {
        return NOT_FOUND;
      }

      // Only Generate has a production grounding predicate strong enough for
      // its product promise. Transformations fail closed until their semantic
      // postcondition can be validated at the execution boundary.
      const action = input.input.action;
      if (!isExecutableGenerationAction(action)) {
        return NOT_FOUND;
      }
      if (!snapshot.settings.enabledCommands.includes(action)) {
        return NOT_FOUND;
      }
      const format = snapshot.reviewFormats.find(
        (candidate) => candidate.id === input.input.styleId,
      );
      if (
        format === undefined ||
        !snapshot.settings.enabledReviewFormatVersionIds.includes(format.id) ||
        !format.supportedCommands.includes(action)
      ) {
        return NOT_FOUND;
      }
      const prompts = snapshot.promptVersions.filter(
        (candidate) => candidate.commandKind === action,
      );
      if (
        prompts.length !== 1 ||
        prompts[0]?.id !== input.input.promptVersionId
      ) {
        return NOT_FOUND;
      }
      const rates = snapshot.priceRates.filter(
        (candidate) =>
          candidate.providerModelId ===
            snapshot.providerRouting.providerModelId &&
          candidate.provider === "fake" &&
          candidate.model === "fake-v1" &&
          candidate.inputPerMillionMicros === 0 &&
          candidate.outputPerMillionMicros === 0,
      );
      if (rates.length !== 1) {
        return NOT_FOUND;
      }
      const rate = rates[0]!;

      const reviewSessionId = newId();
      const assertions: GenerationAssertionDto[] = [];
      if (action === "generate") {
        if (
          input.input.sourceText.trim() !== "" ||
          new Set(input.input.keywordIds).size !== input.input.keywordIds.length
        ) {
          return NOT_FOUND;
        }
        for (const factId of input.input.keywordIds) {
          const fact = snapshot.factOptions.find(
            (candidate) => candidate.id === factId,
          );
          if (
            fact === undefined ||
            !fact.active ||
            !ownsFactOption(fact, scope.tenantId, scope.locationId)
          ) {
            return NOT_FOUND;
          }
          assertions.push({
            id: newId(),
            version: fact.version,
            reviewSessionId,
            semanticId: fact.id,
            proposition: fact.proposition,
            semanticKind: "experience-fact",
            polarity: fact.polarity,
            source: {
              kind: "fact-option",
              factOptionId: fact.id,
              factOptionVersion: fact.version,
            },
          });
        }
        const text = input.input.freeText.trim();
        if (text !== "") {
          const sourceRevisionId = newId();
          assertions.push({
            id: newId(),
            version: newId(),
            reviewSessionId,
            semanticId: newId(),
            proposition: text,
            semanticKind: "experience-fact",
            polarity: "neutral",
            source: {
              kind: "reviewer-text",
              sourceRevisionId,
              start: 0,
              end: text.length,
              quotedText: text,
            },
          });
        }
      } else {
        const text = input.input.sourceText.trim();
        if (
          text === "" ||
          input.input.keywordIds.length > 0 ||
          input.input.freeText.trim() !== ""
        ) {
          return NOT_FOUND;
        }
        const sourceRevisionId = newId();
        assertions.push({
          id: newId(),
          version: newId(),
          reviewSessionId,
          semanticId: newId(),
          proposition: text,
          semanticKind: "experience-fact",
          polarity: "neutral",
          source: {
            kind: "reviewer-text",
            sourceRevisionId,
            start: 0,
            end: text.length,
            quotedText: text,
          },
        });
      }
      if (assertions.length === 0) {
        return NOT_FOUND;
      }

      const command =
        action === "generate"
          ? {
              kind: "generate" as const,
              assertionIds: assertions.map((assertion) => assertion.id),
              rating: input.input.rating ?? 5,
            }
          : {
              kind: "paraphrase" as const,
              sourceTextRevisionId:
                assertions[0]!.source.kind === "reviewer-text"
                  ? assertions[0]!.source.sourceRevisionId
                  : "unreachable",
            };
      const generationId = newId();
      const requestFingerprint = {
        input: input.input,
        snapshotId: snapshot.snapshotId,
        snapshotHash: published.contentHash,
        assertionIds: assertions.map((assertion) => assertion.id),
      };
      const workload = GenerationWorkloadDtoSchema.safeParse({
        bindings: {
          tenantId: scope.tenantId,
          locationId: scope.locationId,
          reviewSessionId,
          generationBatchId: newId(),
          generationId,
          action,
          reviewFormatVersionId: format.id,
          assertionSetHash: hashJson(assertions),
          requestHash: hashJson(requestFingerprint),
          snapshotId: snapshot.snapshotId,
          snapshotHash: published.contentHash,
          providerModelId: snapshot.providerRouting.providerModelId,
          priceRateId: rate.id,
          idempotencyKey: `bench:${generationId}`,
        },
        snapshot,
        command,
        assertions,
      });
      if (!workload.success) {
        return NOT_FOUND;
      }
      const expiresAt = new Date(now().getTime() + receiptTtlMs).toISOString();
      return {
        status: "authorized",
        receipt: authority.signBench({
          workload: workload.data,
          isBench: true,
          expiresAt,
        }),
        workload: workload.data,
      };
    },
  };
}
