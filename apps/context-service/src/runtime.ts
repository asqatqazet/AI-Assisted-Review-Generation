import {
  createPostgresEntryAdmissionStore,
  createPostgresReviewerGenerationAdmissionStore,
  createPostgresReviewSessionReader,
} from "@review/db/admission";
import { createPostgresOperatorAccessStore } from "@review/db/control-plane";

import { hashCapability } from "./capability-hash.js";
import { createContextFunctionHandler } from "./context-function.js";
import { createContextEd25519GenerationAuthority } from "./ed25519-generation-authority.js";
import { createEntryService } from "./entry-service.js";
import { createReviewerGenerationService } from "./reviewer-generation-service.js";
import { createReviewSessionService } from "./review-session-service.js";
import { createReviewerDispositionService } from "./reviewer-disposition-service.js";
import { createReconciliationService } from "./reconciliation-service.js";

export function createContextRuntime({
  databaseUrl,
  contextPrivateKeyPem,
  generationPublicKeyPem,
}: {
  readonly databaseUrl: string;
  readonly contextPrivateKeyPem: string;
  readonly generationPublicKeyPem: string;
}): (event: unknown) => Promise<unknown> {
  const entryStore = createPostgresEntryAdmissionStore({ databaseUrl });
  const reviewSessionReader = createPostgresReviewSessionReader({ databaseUrl });
  const generationStore = createPostgresReviewerGenerationAdmissionStore({
    databaseUrl,
  });
  const operatorAccessStore = createPostgresOperatorAccessStore({ databaseUrl });
  const entry = createEntryService({
    store: entryStore,
    newHandle: () => globalThis.crypto.randomUUID(),
    hashCapability,
  });
  const reviewSession = createReviewSessionService({
    reader: reviewSessionReader,
  });
  const authority = createContextEd25519GenerationAuthority({
    contextPrivateKeyPem,
    generationPublicKeyPem,
  });
  const reviewerGeneration = createReviewerGenerationService({
    store: generationStore,
    authority,
    hashCapability,
  });
  const reviewerDisposition = createReviewerDispositionService({
    reader: reviewSessionReader,
    authority,
    hashCapability,
    newPermitJti: () => globalThis.crypto.randomUUID(),
  });
  const reconciliation = createReconciliationService({
    store: generationStore,
    authority,
  });

  return createContextFunctionHandler({
    operatorService: {
      resolveAccess: async ({ identity }) =>
        await operatorAccessStore.resolveAccess(identity),
    },
    entryService: {
      prepareEntry: entry.prepareEntry,
      readEntryChallenge: entry.readEntryChallenge,
      advanceEntry: entry.advanceEntry,
      readReviewSession: reviewSession.readReviewSession,
      prepareReviewerDisposition:
        reviewerDisposition.prepareReviewerDisposition,
      prepareReviewerGeneration:
        reviewerGeneration.prepareReviewerGeneration,
      activateGeneration: reviewerGeneration.activateGeneration,
      settleGeneration: reviewerGeneration.settleGeneration,
      listReconciliationCandidates:
        reconciliation.listReconciliationCandidates,
      releaseReconciledGeneration:
        reconciliation.releaseReconciledGeneration,
    },
  });
}
