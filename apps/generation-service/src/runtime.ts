import type { GenerationWorkloadDto } from "@review/contracts/generation";
import {
  createPostgresGenerationLeaseJournal,
  createPostgresGenerationTerminalStore,
  createPostgresReviewerDispositionStore,
} from "@review/db/execution-plane";
import { GeminiProvider } from "@review/llm";

import { createPaidWorkAttemptPreparer } from "./application/paid-work-attempt.js";
import type {
  ModelGatewayPort,
  ModelGatewayRequest,
} from "./ports/model-gateway.port.js";
import { createGenerationEd25519WorkAuthority } from "./transport/lambda/ed25519-work-authority.js";
import { createPaidWorkGenerationHandler } from "./transport/lambda/paid-work-handler.js";
import { createPersistentGenerationLeaseJournal } from "./transport/lambda/persistent-lease-journal.js";
import { createPersistentGenerationTerminalStore } from "./transport/lambda/persistent-terminal-store.js";
import { createPersistentTerminalTailer } from "./transport/lambda/persistent-terminal-tailer.js";
import { createReviewerDispositionHandler } from "./transport/lambda/reviewer-disposition-handler.js";

const waitFor = async (
  milliseconds: number,
  signal: AbortSignal | undefined,
): Promise<void> => {
  if (milliseconds === 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    const cancel = (): void => {
      clearTimeout(timeout);
      reject(new Error("FAKE_PROVIDER_CANCELLED"));
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
};

export function createAssessmentFakeGateway(
  workload: GenerationWorkloadDto,
  {
    delayMs,
    fail = false,
  }: { readonly delayMs: number; readonly fail?: boolean },
): ModelGatewayPort {
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
    throw new Error("FakeProvider delay must be between 0 and 60000ms");
  }
  return {
    async generate(request: ModelGatewayRequest, signal?: AbortSignal) {
      if (
        workload.snapshot.providerRouting.primaryProvider !== "fake" ||
        workload.snapshot.providerRouting.primaryModel !== "fake-v1" ||
        request.model !== "fake-v1"
      ) {
        throw new Error("LIVE_PROVIDER_DISABLED");
      }
      await waitFor(delayMs, signal);
      if (fail) {
        throw new Error("FAKE_PROVIDER_UNAVAILABLE");
      }
      const outputWords = workload.assertions.reduce(
        (total, assertion) => total + assertion.proposition.split(/\s+/).length,
        0,
      );
      return {
        output: {
          claims: workload.assertions.map((assertion, index) => ({
            id: `fake-claim-${index + 1}`,
            text: assertion.proposition,
            assertionIds: [assertion.id],
          })),
        },
        attempt: {
          provider: "fake",
          model: "fake-v1",
          usage: {
            inputTokens: Math.max(1, Math.ceil(JSON.stringify(request).length / 4)),
            outputTokens: Math.max(1, outputWords),
          },
          receipt: {
            requestId: `fake-${workload.bindings.generationId}`,
            finishReason: "stop",
          },
        },
      };
    },
  };
}

/**
 * A provider that configuration routes to but which this deployment cannot
 * run is a misconfiguration, not a reason to substitute another one: serving
 * deterministic text as a real draft would be worse than failing.
 */
export { selectGateway as selectGatewayForTest };

function selectGateway({
  routedProvider,
  workload,
  geminiApiKey,
  fakeDelayMs,
  fakeFailure,
}: {
  readonly routedProvider: string;
  readonly workload: GenerationWorkloadDto;
  readonly geminiApiKey: string | undefined;
  readonly fakeDelayMs: number;
  readonly fakeFailure: boolean;
}): ModelGatewayPort {
  if (routedProvider === "fake") {
    return createAssessmentFakeGateway(workload, {
      delayMs: fakeDelayMs,
      fail: fakeFailure,
    });
  }
  if (routedProvider === "gemini") {
    if (geminiApiKey === undefined || geminiApiKey.length === 0) {
      throw new Error("GENERATION_PROVIDER_CREDENTIAL_MISSING");
    }
    return new GeminiProvider({ apiKey: geminiApiKey });
  }
  throw new Error("GENERATION_PROVIDER_NOT_AVAILABLE");
}

export function createGenerationRuntime({
  databaseUrl,
  contextPublicKeyPem,
  generationPrivateKeyPem,
  geminiApiKey,
  fakeDelayMs = 0,
  fakeFailure = false,
}: {
  readonly databaseUrl: string;
  readonly contextPublicKeyPem: string;
  readonly generationPrivateKeyPem: string;
  /**
   * Absent unless an operator installed a key. Without one the deployment
   * keeps using the deterministic provider and makes no paid call.
   */
  readonly geminiApiKey?: string | undefined;
  readonly fakeDelayMs?: number;
  readonly fakeFailure?: boolean;
}): (event: unknown) => Promise<unknown> {
  const databaseJournal = createPostgresGenerationLeaseJournal({ databaseUrl });
  const databaseTerminalStore = createPostgresGenerationTerminalStore({
    databaseUrl,
  });
  const reviewerDispositionStore = createPostgresReviewerDispositionStore({
    databaseUrl,
  });
  const leaseJournal = createPersistentGenerationLeaseJournal(databaseJournal);
  const terminalStore = createPersistentGenerationTerminalStore(
    databaseTerminalStore,
  );
  const authority = createGenerationEd25519WorkAuthority({
    contextPublicKeyPem,
    generationPrivateKeyPem,
  });

  return createPaidWorkGenerationHandler({
    permitVerifier: {
      verify: async (permit, workload) =>
        await authority.verifyPermit(permit, workload),
    },
    activationVerifier: {
      verify: async (activation, leaseId, workload) =>
        await authority.verifyActivation(activation, leaseId, workload),
    },
    leaseJournal,
    receiptSigner: authority,
    terminalStore,
    prepareAttempt: async (workload) =>
      await createPaidWorkAttemptPreparer({
        /**
         * The routed provider decides which gateway runs, never the mere
         * presence of a key. Installing a Gemini credential must not silently
         * redirect traffic that configuration still routes to the
         * deterministic provider — the model name would not even exist there.
         */
        gateway: selectGateway({
          routedProvider: workload.snapshot.providerRouting.primaryProvider,
          workload,
          geminiApiKey,
          fakeDelayMs,
          fakeFailure,
        }),
      })(workload),
    tailExisting: createPersistentTerminalTailer({
      databaseStore: databaseTerminalStore,
      receiptSigner: authority,
    }),
    recordDisposition: createReviewerDispositionHandler({
      verifier: authority,
      store: reviewerDispositionStore,
    }),
  });
}
