import {
  ConsoleContextFunctionInvocationDtoSchema,
  ResolveOperatorAccessInvocationResultDtoSchema,
  type ResolveOperatorAccessInvocationDto,
  type ResolveOperatorAccessInvocationResultDto,
} from "@review/contracts/context";
import {
  AuthorizeConsoleBenchInvocationResultDtoSchema,
  AuthorizeConsoleReadInvocationResultDtoSchema,
  ConsoleRequestInvocationResultDtoSchema,
  type AuthorizeConsoleBenchInvocationDto,
  type AuthorizeConsoleBenchInvocationResultDto,
  type AuthorizeConsoleReadInvocationDto,
  type AuthorizeConsoleReadInvocationResultDto,
  type ConsoleRequestInvocationDto,
  type ConsoleRequestInvocationResultDto,
} from "@review/contracts/console";

export interface ConsoleContextOptions {
  readonly operatorService: {
    resolveAccess(
      input: ResolveOperatorAccessInvocationDto["input"],
    ): Promise<ResolveOperatorAccessInvocationResultDto["result"]>;
  };
  readonly consoleService: {
    request(
      input: ConsoleRequestInvocationDto["input"],
    ): Promise<ConsoleRequestInvocationResultDto["result"]>;
    authorizeRead(
      input: AuthorizeConsoleReadInvocationDto["input"],
    ): Promise<AuthorizeConsoleReadInvocationResultDto["result"]>;
  };
  readonly consoleBenchAuthorizer: {
    authorize(
      input: AuthorizeConsoleBenchInvocationDto["input"],
    ): Promise<AuthorizeConsoleBenchInvocationResultDto["result"]>;
  };
}

export function createConsoleContextFunctionHandler({
  operatorService,
  consoleService,
  consoleBenchAuthorizer,
}: ConsoleContextOptions): (event: unknown) => Promise<unknown> {
  return async (event) => {
    const invocation = ConsoleContextFunctionInvocationDtoSchema.parse(event);
    switch (invocation.operation) {
      case "resolve-operator-access":
        return ResolveOperatorAccessInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result: await operatorService.resolveAccess(invocation.input),
        });
      case "console-request":
        return ConsoleRequestInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result: await consoleService.request(invocation.input),
        });
      case "authorize-console-read":
        return AuthorizeConsoleReadInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result: await consoleService.authorizeRead(invocation.input),
        });
      case "authorize-console-bench":
        return AuthorizeConsoleBenchInvocationResultDtoSchema.parse({
          operation: invocation.operation,
          result: await consoleBenchAuthorizer.authorize(invocation.input),
        });
    }
  };
}
