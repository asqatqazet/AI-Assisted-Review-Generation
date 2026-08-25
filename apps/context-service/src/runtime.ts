import {
  createPostgresEntryAdmissionStore,
  createPostgresPublicSourceRateLimitStore,
  createPostgresReviewSessionProgressStore,
  createPostgresReviewerGenerationAdmissionStore,
  createPostgresReviewSessionReader,
} from "@review/db/admission";
import {
  createPostgresConsoleControlPlaneStore,
  createPostgresOperatorAccessStore,
} from "@review/db/control-plane";

import { hashCapability } from "./capability-hash.js";
import { createConsoleService } from "./console/console-service.js";
import { createConsoleBenchAuthorizer } from "./console/console-bench-authorizer.js";
import { createConsoleBenchAuthority } from "./console/console-bench-authority.js";
import { createConsoleReadAuthority } from "./console/console-read-authority.js";
import { createContextFunctionHandler } from "./context-function.js";
import { createContextEd25519GenerationAuthority } from "./ed25519-generation-authority.js";
import { createEntryService } from "./entry-service.js";
import { createReviewerGenerationService } from "./reviewer-generation-service.js";
import { createReviewerDraftRevisionService } from "./reviewer-draft-revision-service.js";
import { createReviewSessionService } from "./review-session-service.js";
import { createReviewerDispositionService } from "./reviewer-disposition-service.js";
import { createReconciliationService } from "./reconciliation-service.js";
import { createPublicSourceRateLimitService } from "./public-source-rate-limit-service.js";

export function createContextRuntime({
  runtimeDatabaseUrl,
  consoleControlDatabaseUrl,
  contextPrivateKeyPem,
  consoleAuthorityPrivateKeyPem,
  consoleDatabaseAuthoritySecret,
  generationPublicKeyPem,
  publicSourceRateHmacSecret,
  providerMode,
}: {
  readonly runtimeDatabaseUrl: string;
  readonly consoleControlDatabaseUrl: string;
  readonly contextPrivateKeyPem: string;
  readonly consoleAuthorityPrivateKeyPem: string;
  readonly consoleDatabaseAuthoritySecret: string;
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
  const operatorAccessStore = createPostgresOperatorAccessStore({
    databaseUrl: consoleControlDatabaseUrl,
    consoleDatabaseAuthoritySecret,
  });
  const consoleStore = createPostgresConsoleControlPlaneStore({
    databaseUrl: consoleControlDatabaseUrl,
    consoleDatabaseAuthoritySecret,
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

  return createContextFunctionHandler({
    publicSourceRateLimiter,
    /**
     * The Console resolves Access Grants itself rather than trusting the scope
     * the BFF forwards. Views backed by Generation history stay unavailable
     * until the execution-plane reader is wired.
     */
    consoleService: createConsoleService({
      store: consoleStore,
      providerMode: providerMode === "fake-only" ? "fake-only" : "configured",
      readAuthority: createConsoleReadAuthority({
        consoleAuthorityPrivateKeyPem,
      }),
      resolveAccess: async (identity) =>
        await operatorAccessStore.resolveAccess(identity),
    }),
    consoleBenchAuthorizer: createConsoleBenchAuthorizer({
      store: consoleStore,
      authority: createConsoleBenchAuthority({
        consoleAuthorityPrivateKeyPem,
      }),
      resolveAccess: async (identity) =>
        await operatorAccessStore.resolveAccess(identity),
    }),
    operatorService: {
      resolveAccess: async ({ identity }) =>
        await operatorAccessStore.resolveAccess(identity),
    },
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
