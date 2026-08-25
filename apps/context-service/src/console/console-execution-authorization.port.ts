import type {
  ConsoleReadQueryDto,
  ConsoleReadScopeDto,
} from "@review/contracts/console";

export interface ConsoleExecutionAuthorizationStore {
  mint(input: {
    readonly operatorId: string;
    readonly scope: ConsoleReadScopeDto;
    readonly query: ConsoleReadQueryDto;
    readonly expiresAt: string;
  }): Promise<
    | {
        readonly authorizationId: string;
        readonly expiresAt: string;
        readonly readMode: "redacted" | "audit";
      }
    | null
  >;
}
