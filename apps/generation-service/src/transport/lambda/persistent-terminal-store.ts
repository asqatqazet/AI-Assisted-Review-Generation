import type { PostgresGenerationTerminalStore } from "@review/db/execution-plane";

import type { GenerationTerminalStore } from "./paid-work-handler.js";

type DatabaseStore = Pick<PostgresGenerationTerminalStore, "complete">;

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
  return {
    async complete({ leaseId, attemptId, permitJti, workload, result }) {
      if (
        result.generationId !== workload.bindings.generationId ||
        result.attemptId !== attemptId
      ) {
        throw new Error("Terminal result does not match the fenced execution");
      }
      const promptVersions = workload.snapshot.promptVersions.filter(
        (prompt) => prompt.commandKind === workload.command.kind,
      );
      if (promptVersions.length !== 1 || promptVersions[0] === undefined) {
        throw new Error("Terminal Generation has no unique Prompt Version");
      }

      const claims = result.claims.map((claim) => {
        const assertionIds = claim.grounding.flatMap((source) =>
          source.kind === "assertion" ? [source.assertionId] : [],
        );
        if (
          assertionIds.length === 0 ||
          assertionIds.length !== claim.grounding.length
        ) {
          throw new Error("Student terminal store accepts Assertion grounding only");
        }
        return { proposition: claim.text, assertionIds };
      });

      return await databaseStore.complete({
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
        leaseId,
        attemptId,
        result: {
          draft: result.draft,
          claims,
          inputTokens: result.attempt.usage.inputTokens,
          outputTokens: result.attempt.usage.outputTokens,
          providerReceipt: result.attempt.receipt,
        },
      });
    },
  };
}
