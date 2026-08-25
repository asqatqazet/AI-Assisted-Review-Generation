import { PrivateGenerationTerminalEventDtoSchema } from "@review/contracts/generation";

import type {
  GenerationReceiptSigner,
  GenerationTerminalStore,
  PaidWorkGenerationHandlerOptions,
} from "./paid-work-handler.js";

type TerminalStore = Pick<GenerationTerminalStore, "recover">;
type ReceiptSigner = Pick<GenerationReceiptSigner, "signTerminal">;

export function createPersistentTerminalTailer({
  terminalStore,
  receiptSigner,
  wait = async (milliseconds) =>
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  maxPolls = 650,
}: {
  readonly terminalStore: TerminalStore;
  readonly receiptSigner: ReceiptSigner;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly maxPolls?: number;
}): PaidWorkGenerationHandlerOptions["tailExisting"] {
  if (!Number.isInteger(maxPolls) || maxPolls < 1) {
    throw new Error("Terminal tail poll limit must be positive");
  }
  return async ({ attemptId, leaseId, permitJti, workload }) => {
    for (let poll = 0; poll < maxPolls; poll += 1) {
      const recovered = await terminalStore.recover({
        attemptId,
        leaseId,
        permitJti,
        workload,
      });
      if (recovered.state === "indeterminate") {
        throw new Error("PROVIDER_RESULT_INDETERMINATE");
      }
      if (recovered.state === "completed") {
        const terminal = recovered.terminal;
        if ("rejection" in terminal) {
          const terminalReceipt = await receiptSigner.signTerminal({
            leaseId,
            permitJti,
            outcome: "rejected",
            actualCostMicros: terminal.actualCostMicros,
            ...workload.bindings,
          });
          return PrivateGenerationTerminalEventDtoSchema.parse({
            type: "terminal",
            status: "rejected",
            terminalReceipt,
            code: terminal.rejection.code,
            retryable: terminal.rejection.retryable,
          });
        }
        const terminalReceipt = await receiptSigner.signTerminal({
          leaseId,
          permitJti,
          outcome: "completed",
          actualCostMicros: terminal.actualCostMicros,
          ...workload.bindings,
        });
        return PrivateGenerationTerminalEventDtoSchema.parse({
          type: "terminal",
          status: "completed",
          terminalReceipt,
          draft: terminal.draft,
        });
      }
      if (poll < maxPolls - 1) {
        await wait(100);
      }
    }
    throw new Error("GENERATION_TERMINAL_NOT_AVAILABLE");
  };
}
