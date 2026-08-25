import { ConsoleBenchInvocationDtoSchema } from "@review/contracts/console-bench";
import { ConsoleReadInvocationDtoSchema } from "@review/contracts/console-read";
import type { GenerationWorkloadDto } from "@review/contracts/generation";
import {
  createPostgresConsoleExecutionProjectionStore,
  createPostgresGenerationLeaseJournal,
  createPostgresGenerationTerminalStore,
  createPostgresReviewerDispositionStore,
} from "@review/db/execution-plane";
import { GeminiProvider, OpenAIProvider } from "@review/llm";

import { createPaidWorkAttemptPreparer } from "./application/paid-work-attempt.js";
import { createPostgresConsoleExecutionReader } from "./adapters/postgres-console-execution-reader.js";
import { createConsoleReadHandler } from "./console-read-handler.js";
import { createConsoleReadVerifier } from "./console-read-verifier.js";
import {
  createConsoleBenchHandler,
  createNonPersistentConsoleBenchSink,
} from "./console-bench-handler.js";
import { createConsoleBenchVerifier } from "./console-bench-verifier.js";
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
import { createReviewerDraftRevisionHandler } from "./transport/lambda/reviewer-draft-revision-handler.js";

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
  workload,
  providerMode,
  geminiApiKey,
  openaiApiKey,
  fakeDelayMs,
  fakeFailure,
}: {
  readonly workload: GenerationWorkloadDto;
  readonly providerMode: "fake-only" | "paid-enabled";
  readonly geminiApiKey: string | undefined;
  readonly openaiApiKey?: string | undefined;
  readonly fakeDelayMs: number;
  readonly fakeFailure: boolean;
}): ModelGatewayPort {
  const routedProvider = workload.snapshot.providerRouting.primaryProvider;
  if (providerMode === "fake-only" && routedProvider !== "fake") {
    throw new Error("LIVE_PROVIDER_DISABLED");
  }
  if (routedProvider === "fake") {
    return createAssessmentFakeGateway(workload, {
      delayMs: fakeDelayMs,
      fail: fakeFailure,
    });
  }
  const routedRate = workload.snapshot.priceRates.find(
    (rate) => rate.id === workload.bindings.priceRateId,
  );
  if (
    workload.snapshot.settings.monthlyBudgetMicros <= 0 ||
    routedRate === undefined ||
    routedRate.providerModelId !==
      workload.snapshot.providerRouting.providerModelId ||
    routedRate.provider !== routedProvider ||
    routedRate.model !== workload.snapshot.providerRouting.primaryModel
  ) {
    throw new Error("GENERATION_PROVIDER_DISABLED");
  }
  if (routedProvider === "gemini") {
    if (geminiApiKey === undefined || geminiApiKey.length === 0) {
      throw new Error("GENERATION_PROVIDER_CREDENTIAL_MISSING");
    }
    return new GeminiProvider({ apiKey: geminiApiKey });
  }
  if (routedProvider === "openai") {
    if (openaiApiKey === undefined || openaiApiKey.length === 0) {
      throw new Error("GENERATION_PROVIDER_CREDENTIAL_MISSING");
    }
    return new OpenAIProvider({ apiKey: openaiApiKey });
  }
  throw new Error("GENERATION_PROVIDER_NOT_AVAILABLE");
}

export function createGenerationRuntime({
  databaseUrl,
  providerMode,
  contextPublicKeyPem,
  consoleAuthorityPublicKeyPem,
  generationPrivateKeyPem,
  geminiApiKey,
  openaiApiKey,
  fakeDelayMs = 0,
  fakeFailure = false,
}: {
  readonly databaseUrl: string;
  readonly providerMode: "fake-only" | "paid-enabled";
  readonly contextPublicKeyPem: string;
  readonly consoleAuthorityPublicKeyPem: string;
  readonly generationPrivateKeyPem: string;
  /**
   * Absent unless an operator installed a key. A snapshot routed to Gemini
   * fails closed when this secret is absent; it never falls back.
   */
  readonly geminiApiKey?: string | undefined;
  /**
   * Injected independently from the immutable configuration snapshot. Merely
   * installing it does not route work to OpenAI.
   */
  readonly openaiApiKey?: string | undefined;
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
  const consoleProjectionStore = createPostgresConsoleExecutionProjectionStore({
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

  const paidWorkHandler = createPaidWorkGenerationHandler({
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
          workload,
          providerMode,
          geminiApiKey,
          openaiApiKey,
          fakeDelayMs,
          fakeFailure,
        }),
      })(workload),
    tailExisting: createPersistentTerminalTailer({
      terminalStore,
      receiptSigner: authority,
    }),
    recordDisposition: createReviewerDispositionHandler({
      verifier: authority,
      store: reviewerDispositionStore,
    }),
    recordDraftRevision: createReviewerDraftRevisionHandler({
      verifier: authority,
      store: reviewerDispositionStore,
    }),
  });
  const consoleReadHandler = createConsoleReadHandler({
    verifier: createConsoleReadVerifier({ consoleAuthorityPublicKeyPem }),
    reader: createPostgresConsoleExecutionReader(consoleProjectionStore),
  });
  const consoleBenchHandler = createConsoleBenchHandler({
    verifier: createConsoleBenchVerifier({ consoleAuthorityPublicKeyPem }),
    prepareAttempt: async (workload) =>
      await createPaidWorkAttemptPreparer({
        // Bench has its own signed fake-only route and can never select a paid
        // gateway merely because a provider credential is installed.
        gateway: createAssessmentFakeGateway(workload, {
          delayMs: fakeDelayMs,
          fail: fakeFailure,
        }),
      })(workload),
    sink: createNonPersistentConsoleBenchSink(),
  });

  return async (event: unknown): Promise<unknown> =>
    ConsoleReadInvocationDtoSchema.safeParse(event).success
      ? await consoleReadHandler(event)
      : ConsoleBenchInvocationDtoSchema.safeParse(event).success
        ? await consoleBenchHandler(event)
      : await paidWorkHandler(event);
}
