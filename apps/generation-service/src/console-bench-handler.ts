import {
  ConsoleBenchInvocationDtoSchema,
  ConsoleBenchInvocationResultDtoSchema,
  type ConsoleBenchInvocationResultDto,
  type ConsoleBenchResultDto,
} from "@review/contracts/console-bench";
import type { GenerationWorkloadDto } from "@review/contracts/generation";

import type { PreparedPaidWorkAttempt } from "./application/paid-work-attempt.js";
import type { ConsoleBenchVerifier } from "./console-bench-verifier.js";

/**
 * This seam is deliberately incapable of persistence or billing. Production
 * Bench composition supplies the no-op implementation below; tests may only
 * observe that a result passed through it.
 */
export interface NonPersistentConsoleBenchSink {
  readonly persistence: "none";
  record(result: ConsoleBenchResultDto): Promise<void>;
}

export function createNonPersistentConsoleBenchSink({
  record = async () => undefined,
}: {
  readonly record?: ((result: ConsoleBenchResultDto) => Promise<void>) | undefined;
} = {}): NonPersistentConsoleBenchSink {
  return { persistence: "none", record };
}

export function createConsoleBenchHandler({
  verifier,
  prepareAttempt,
  sink,
  nowMs = () => Date.now(),
  newAttemptId = () => globalThis.crypto.randomUUID(),
}: {
  readonly verifier: ConsoleBenchVerifier;
  readonly prepareAttempt: (
    workload: GenerationWorkloadDto,
  ) => Promise<PreparedPaidWorkAttempt>;
  readonly sink: NonPersistentConsoleBenchSink;
  readonly nowMs?: (() => number) | undefined;
  readonly newAttemptId?: (() => string) | undefined;
}): (event: unknown) => Promise<ConsoleBenchInvocationResultDto> {
  return async (event) => {
    const parsed = ConsoleBenchInvocationDtoSchema.safeParse(event);
    if (!parsed.success) {
      return { operation: "console-bench", result: { status: "not-found" } };
    }
    const invocation = parsed.data;
    if (
      verifier.verify({
        receipt: invocation.input.receipt,
        workload: invocation.input.workload,
      }).status !== "verified"
    ) {
      return { operation: "console-bench", result: { status: "not-found" } };
    }

    const startedAt = nowMs();
    const prepared = await prepareAttempt(invocation.input.workload);
    const completed = await prepared.execute(newAttemptId());
    const rate = invocation.input.workload.snapshot.priceRates.find(
      (candidate) =>
        candidate.id === invocation.input.workload.bindings.priceRateId,
    );
    if (
      rate === undefined ||
      rate.inputPerMillionMicros !== 0 ||
      rate.outputPerMillionMicros !== 0 ||
      completed.attempt.provider !== "fake" ||
      completed.attempt.model !== "fake-v1"
    ) {
      throw new Error("BENCH_ZERO_COST_ROUTE_VIOLATED");
    }
    if (completed.status === "rejected") {
      throw new Error(`BENCH_${completed.code}`);
    }

    const result: ConsoleBenchResultDto = {
      generationId: completed.generationId,
      output: completed.draft,
      claims: completed.claims.map((claim) => ({
        id: claim.id,
        text: claim.text,
        supportedBy: claim.grounding.flatMap((reference) =>
          reference.kind === "assertion" ? [reference.assertionId] : [],
        ),
      })),
      removedClaims: [],
      provider: completed.attempt.provider,
      model: completed.attempt.model,
      latencyMs: Math.max(0, Math.round(nowMs() - startedAt)),
      estimatedCost: { amountMicros: 0, currency: rate.currency },
      isBench: true,
      guard: {
        verdict: "passed",
        supportedClaimIds: completed.claims.map((claim) => claim.id),
        removedClaimCount: 0,
      },
    };
    await sink.record(result);
    return ConsoleBenchInvocationResultDtoSchema.parse({
      operation: "console-bench",
      result: { status: "completed", result },
    });
  };
}
