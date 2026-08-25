import type { PostgresGenerationTerminalStore } from "@review/db/execution-plane";

import { validatePaidWorkTerminalDraft } from "../../application/paid-work-attempt.js";
import type { GenerationTerminalStore } from "./paid-work-handler.js";

type DatabaseStore = Pick<
  PostgresGenerationTerminalStore,
  | "read"
  | "checkpoint"
  | "complete"
  | "recoveryState"
  | "recoverByScope"
  | "markIndeterminate"
  | "reject"
>;

const toDatabaseAction = (
  action:
    | "generate"
    | "paraphrase"
    | "reformat"
    | "condense"
    | "expand"
    | "revise-wording"
    | "resample",
):
  | "GENERATE"
  | "PARAPHRASE"
  | "REFORMAT"
  | "CONDENSE"
  | "EXPAND"
  | "REVISE_WORDING"
  | "RESAMPLE" => {
  switch (action) {
    case "generate":
      return "GENERATE";
    case "paraphrase":
      return "PARAPHRASE";
    case "reformat":
      return "REFORMAT";
    case "condense":
      return "CONDENSE";
    case "expand":
      return "EXPAND";
    case "revise-wording":
      return "REVISE_WORDING";
    case "resample":
      return "RESAMPLE";
  }
};

export function createPersistentGenerationTerminalStore(
  databaseStore: DatabaseStore,
): GenerationTerminalStore {
  const databaseScope = ({
    permitJti,
    workload,
  }: {
    readonly permitJti: string;
    readonly workload: Parameters<GenerationTerminalStore["complete"]>[0]["workload"];
  }) => {
    const promptVersions = workload.snapshot.promptVersions.filter(
      (prompt) => prompt.commandKind === workload.command.kind,
    );
    if (promptVersions.length !== 1 || promptVersions[0] === undefined) {
      throw new Error("Terminal Generation has no unique Prompt Version");
    }
    return {
      tenantId: workload.bindings.tenantId,
      locationId: workload.bindings.locationId,
      reviewSessionId: workload.bindings.reviewSessionId,
      generationBatchId: workload.bindings.generationBatchId,
      generationId: workload.bindings.generationId,
      permitJti,
      snapshotId: workload.bindings.snapshotId,
      promptVersionId: promptVersions[0].id,
      reviewFormatVersionId: workload.bindings.reviewFormatVersionId,
      action: toDatabaseAction(workload.bindings.action),
    } as const;
  };

  const databaseExecution = ({
    leaseId,
    attemptId,
    permitJti,
    workload,
  }: {
    readonly leaseId: string;
    readonly attemptId: string;
    readonly permitJti: string;
    readonly workload: Parameters<GenerationTerminalStore["complete"]>[0]["workload"];
  }) => {
    return {
      ...databaseScope({ permitJti, workload }),
      leaseId,
      attemptId,
    } as const;
  };

  return {
    async checkpoint({ leaseId, attemptId, permitJti, workload, result }) {
      if (
        result.generationId !== workload.bindings.generationId ||
        result.attemptId !== attemptId
      ) {
        throw new Error("Terminal result does not match the fenced execution");
      }
      const validation =
        result.status === "completed"
          ? validatePaidWorkTerminalDraft(workload, result)
          : { verdict: "rejected" as const, code: result.code };
      const checkpointResult =
        validation.verdict === "rejected"
          ? ({
              status: "rejected" as const,
              code: validation.code,
              retryable: false as const,
            } as const)
          : ({
              status: "completed" as const,
              draftBody: result.status === "completed" ? result.draftBody : "",
              systemAnnotations:
                result.status === "completed" ? result.systemAnnotations : [],
              claims:
                result.status === "completed"
                  ? result.claims.map((claim) => {
                      const assertionIds = claim.grounding.flatMap((source) =>
                        source.kind === "assertion" ? [source.assertionId] : [],
                      );
                      if (
                        assertionIds.length === 0 ||
                        assertionIds.length !== claim.grounding.length
                      ) {
                        throw new Error(
                          "Terminal store accepts Assertion grounding only",
                        );
                      }
                      return { proposition: claim.text, assertionIds };
                    })
                  : [],
            } as const);

      await databaseStore.checkpoint({
        ...databaseExecution({ leaseId, attemptId, permitJti, workload }),
        result: {
          providerOutput: result.providerOutput,
          inputTokens: result.attempt.usage.inputTokens,
          outputTokens: result.attempt.usage.outputTokens,
          providerReceipt: result.attempt.receipt,
          ...checkpointResult,
        },
      });
    },

    async complete(input) {
      return await databaseStore.complete(databaseExecution(input));
    },

    async recover(input) {
      const databaseInput = databaseExecution(input);
      const existing = await databaseStore.read(databaseInput);
      if (existing !== null) {
        return { state: "completed", terminal: existing } as const;
      }
      const recovery = await databaseStore.recoveryState(databaseInput);
      if (recovery.state === "checkpointed") {
        const terminal = await databaseStore.complete(databaseInput);
        return { state: "completed", terminal } as const;
      }
      return recovery;
    },

    async recoverByScope(input) {
      return await databaseStore.recoverByScope(databaseScope(input));
    },

    async markIndeterminate(input) {
      return await databaseStore.markIndeterminate({
        ...databaseExecution(input),
        code: "PROVIDER_RESULT_INDETERMINATE",
      });
    },

    async reject({ leaseId, attemptId, permitJti, workload, code, retryable }) {
      return await databaseStore.reject({
        ...databaseExecution({ leaseId, attemptId, permitJti, workload }),
        code,
        retryable,
      });
    },
  };
}
