import {
  ConsoleReadInvocationDtoSchema,
  ConsoleReadInvocationResultDtoSchema,
  type ConsoleReadInvocationResultDto,
} from "@review/contracts/console-read";

import type { ConsoleReadVerifier } from "./console-read-verifier.js";

export interface ConsoleExecutionReader {
  read(input: {
    readonly authorizationId: string;
    readonly view: "overview" | "analytics" | "generation-detail";
    readonly readMode: "redacted" | "audit";
  }): Promise<ConsoleReadInvocationResultDto["result"]>;
}

/**
 * Verifies the Context receipt before the execution database is reachable.
 * Keeping that order here makes a malformed or widened request unable to
 * become even a timing oracle over execution-plane rows.
 */
export function createConsoleReadHandler({
  verifier,
  reader,
}: {
  readonly verifier: ConsoleReadVerifier;
  readonly reader: ConsoleExecutionReader;
}): (event: unknown) => Promise<ConsoleReadInvocationResultDto> {
  return async (event) => {
    const invocation = ConsoleReadInvocationDtoSchema.parse(event);
    const verified = verifier.verify({
      receipt: invocation.input.receipt,
      authorizationId: invocation.input.authorizationId,
    });
    if (verified.status === "rejected") {
      return { operation: "console-read", result: { status: "not-found" } };
    }

    const result = await reader.read({
      authorizationId: verified.authorizationId,
      view: verified.view,
      readMode: verified.readMode,
    });
    return ConsoleReadInvocationResultDtoSchema.parse({
      operation: "console-read",
      result,
    });
  };
}
