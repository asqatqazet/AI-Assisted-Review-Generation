import {
  createPostgresEntryAdmissionStore,
  createPostgresPublicSourceRateLimitStore,
  createPostgresReviewSessionProgressStore,
  createPostgresReviewerGenerationAdmissionStore,
  createPostgresReviewSessionReader,
} from "@review/db/admission";

import { hashCapability } from "./capability-hash.js";
import { createContextEd25519GenerationAuthority } from "./ed25519-generation-authority.js";
import { createEntryService } from "./entry-service.js";
import { createReconciliationService } from "./reconciliation-service.js";
import { createPublicSourceRateLimitService } from "./public-source-rate-limit-service.js";
import { createReviewSessionService } from "./review-session-service.js";
import { createReviewerDispositionService } from "./reviewer-disposition-service.js";
import { createReviewerDraftRevisionService } from "./reviewer-draft-revision-service.js";
import { createReviewerGenerationService } from "./reviewer-generation-service.js";
import { createReviewerContextFunctionHandler } from "./reviewer-context-function.js";

export function createContextReviewerRuntime({
  runtimeDatabaseUrl,
  contextPrivateKeyPem,
  generationPublicKeyPem,
  publicSourceRateHmacSecret,
  providerMode,
}: {
  readonly runtimeDatabaseUrl: string;
  readonly contextPrivateKeyPem: string;
  readonly generationPublicKeyPem: string;
  readonly publicSourceRateHmacSecret: string;
  readonly providerMode: "fake-only" | "paid-enabled";
}): (event: unknown) => Promise<unknown> {
  const entryStore = createPostgresEntryAdmissionStore({
    databaseUrl: runtimeDatabaseUrl,
  });
  const reviewSessionReader = createPostgresReviewSessionReader({
    databaseUrl: runtimeDatabaseUrl,
  });
  const reviewSessionProgressStore = createPostgresReviewSessionProgressStore({
    databaseUrl: runtimeDatabaseUrl,
  });
  const generationStore = createPostgresReviewerGenerationAdmissionStore({
    databaseUrl: runtimeDatabaseUrl,
    providerMode,
  });
  const publicSourceRateLimitStore = createPostgresPublicSourceRateLimitStore({
    databaseUrl: runtimeDatabaseUrl,
  });
  const publicSourceRateLimiter = createPublicSourceRateLimitService({
    secret: publicSourceRateHmacSecret,
    store: publicSourceRateLimitStore,
  });
  const entry = createEntryService({
    store: entryStore,
    newHandle: () => globalThis.crypto.randomUUID(),
    hashCapability,
  });
  const reviewSession = createReviewSessionService({
    reader: reviewSessionReader,
    progressStore: reviewSessionProgressStore,
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
  const reviewerDraftRevision = createReviewerDraftRevisionService({
    reader: reviewSessionReader,
    authority,
    hashCapability,
    newPermitJti: () => globalThis.crypto.randomUUID(),
  });
  const reconciliation = createReconciliationService({
    store: generationStore,
    authority,
    cleanupPublicSourceRateLimits: async () =>
      await publicSourceRateLimitStore.cleanupExpired(),
  });

  return createReviewerContextFunctionHandler({
    publicSourceRateLimiter,
    entryService: {
      prepareEntry: entry.prepareEntry,
      readEntryChallenge: entry.readEntryChallenge,
      advanceEntry: entry.advanceEntry,
      verifyEntry: entry.verifyEntry,
      readReviewSession: reviewSession.readReviewSession,
      saveReviewSessionProgress: reviewSession.saveReviewSessionProgress,
      forgetReviewSession: reviewSession.forgetReviewSession,
      prepareReviewerDraftRevision:
        reviewerDraftRevision.prepareReviewerDraftRevision,
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
