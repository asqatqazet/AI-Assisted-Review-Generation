import { PrivateGenerationTerminalEventDtoSchema } from "@review/contracts/generation";
import type { PostgresGenerationTerminalStore } from "@review/db/execution-plane";

import type {
  GenerationReceiptSigner,
  PaidWorkGenerationHandlerOptions,
} from "./paid-work-handler.js";

type DatabaseStore = Pick<PostgresGenerationTerminalStore, "read">;
type ReceiptSigner = Pick<GenerationReceiptSigner, "signTerminal">;

export function createPersistentTerminalTailer({
  databaseStore,
  receiptSigner,
  wait = async (milliseconds) =>
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  maxPolls = 650,
}: {
  readonly databaseStore: DatabaseStore;
  readonly receiptSigner: ReceiptSigner;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly maxPolls?: number;
}): PaidWorkGenerationHandlerOptions["tailExisting"] {
  if (!Number.isInteger(maxPolls) || maxPolls < 1) {
    throw new Error("Terminal tail poll limit must be positive");
  }
  return async ({ leaseId, permitJti, workload }) => {
    for (let poll = 0; poll < maxPolls; poll += 1) {
      const terminal = await databaseStore.read({
        tenantId: workload.bindings.tenantId,
        locationId: workload.bindings.locationId,
        reviewSessionId: workload.bindings.reviewSessionId,
        generationBatchId: workload.bindings.generationBatchId,
        generationId: workload.bindings.generationId,
        permitJti,
      });
      if (terminal !== null) {
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
