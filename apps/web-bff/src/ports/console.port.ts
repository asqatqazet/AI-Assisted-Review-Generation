import type {
  ConsoleRequestInvocationDto,
  ConsoleRequestInvocationResultDto,
} from "@review/contracts/console";

export interface ConsolePort {
  request(
    input: ConsoleRequestInvocationDto["input"],
  ): Promise<ConsoleRequestInvocationResultDto["result"]>;
}
