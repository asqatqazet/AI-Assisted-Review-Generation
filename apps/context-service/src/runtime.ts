import {
  createPostgresEntryAdmissionStore,
  createPostgresReviewerGenerationAdmissionStore,
  createPostgresReviewSessionReader,
} from "@review/db/admission";

import { hashCapability } from "./capability-hash.js";
import { createContextFunctionHandler } from "./context-function.js";
import { createContextEd25519GenerationAuthority } from "./ed25519-generation-authority.js";
import { createEntryService } from "./entry-service.js";
import { createReviewerGenerationService } from "./reviewer-generation-service.js";
import { createReviewSessionService } from "./review-session-service.js";

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
  const entry = createEntryService({
    store: entryStore,
    newHandle: () => globalThis.crypto.randomUUID(),
    hashCapability,
  });
  const reviewSession = createReviewSessionService({
    reader: reviewSessionReader,
  });
  const reviewerGeneration = createReviewerGenerationService({
    store: generationStore,
    authority: createContextEd25519GenerationAuthority({
      contextPrivateKeyPem,
      generationPublicKeyPem,
    }),
    hashCapability,
  });

  return createContextFunctionHandler({
    entryService: {
      prepareEntry: entry.prepareEntry,
      readEntryChallenge: entry.readEntryChallenge,
      advanceEntry: entry.advanceEntry,
      readReviewSession: reviewSession.readReviewSession,
      prepareReviewerGeneration:
        reviewerGeneration.prepareReviewerGeneration,
      activateGeneration: reviewerGeneration.activateGeneration,
      settleGeneration: reviewerGeneration.settleGeneration,
    },
  });
}
