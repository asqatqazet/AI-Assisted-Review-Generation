import type {
  AuthorizeConsoleBenchInvocationDto,
  AuthorizeConsoleBenchInvocationResultDto,
  AuthorizeConsoleReadInvocationDto,
  AuthorizeConsoleReadInvocationResultDto,
  ConsoleBenchInvocationDto,
  ConsoleBenchInvocationResultDto,
} from "@review/contracts/console";
import type {
  ConsoleReadInvocationDto,
  ConsoleReadInvocationResultDto,
} from "@review/contracts/console-read";

/** BFF-owned Context remote port: authorization only, never execution data. */
export interface ConsoleExecutionAuthorizationPort {
  authorize(
    input: AuthorizeConsoleReadInvocationDto["input"],
  ): Promise<AuthorizeConsoleReadInvocationResultDto["result"]>;
}

/** BFF-owned Generation remote port: accepts only a Context-signed capability. */
export interface ConsoleExecutionReadPort {
  read(
    input: ConsoleReadInvocationDto["input"],
  ): Promise<ConsoleReadInvocationResultDto["result"]>;
}

/** Context resolves and signs one immutable fake-only Bench workload. */
export interface ConsoleBenchAuthorizationPort {
  authorize(
    input: AuthorizeConsoleBenchInvocationDto["input"],
  ): Promise<AuthorizeConsoleBenchInvocationResultDto["result"]>;
}

/** Generation verifies and executes; the BFF cannot widen the workload. */
export interface ConsoleBenchExecutionPort {
  execute(
    input: ConsoleBenchInvocationDto["input"],
  ): Promise<ConsoleBenchInvocationResultDto["result"]>;
}
