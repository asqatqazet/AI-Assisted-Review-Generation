import { PrismaClient } from "../generated/control-plane/index.js";

import { createConsoleOperatorAuthorizationProof } from "./console-database-authority.js";

export type ConsoleExecutionAuthorizationScope =
  | { readonly type: "platform" }
  | { readonly type: "tenant"; readonly tenantId: string }
  | {
      readonly type: "location";
      readonly tenantId: string;
      readonly locationId: string;
    };

export interface PostgresConsoleExecutionAuthorizationStore {
  mint(input: {
    readonly operatorId: string;
    readonly scope: ConsoleExecutionAuthorizationScope;
    readonly query: unknown;
    readonly expiresAt: string;
  }): Promise<
    | {
        readonly authorizationId: string;
        readonly expiresAt: string;
        readonly readMode: "redacted" | "audit";
      }
    | null
  >;
  disconnect(): Promise<void>;
}

interface AuthorizationRow {
  readonly authorization_id: string;
  readonly expires_at: Date;
  readonly read_mode: "redacted" | "audit";
}

/**
 * Mints one database-verifiable Console read. PostgreSQL rechecks the current
 * Operator and Grants and derives the Tenant set; this adapter never sends a
 * caller-computed Tenant list or raw-content flag.
 */
export function createPostgresConsoleExecutionAuthorizationStore({
  databaseUrl,
  consoleDatabaseAuthoritySecret,
}: {
  readonly databaseUrl: string;
  readonly consoleDatabaseAuthoritySecret: string;
}): PostgresConsoleExecutionAuthorizationStore {
  if (databaseUrl.trim().length === 0) {
    throw new Error("Console control database URL is required");
  }
  const client = new PrismaClient({ datasourceUrl: databaseUrl });

  return {
    async mint(input) {
      const tenantId =
        input.scope.type === "platform" ? null : input.scope.tenantId;
      const locationId =
        input.scope.type === "location" ? input.scope.locationId : null;
      const rows = await client.$transaction(async (transaction) => {
        const proof = createConsoleOperatorAuthorizationProof({
          secretHex: consoleDatabaseAuthoritySecret,
          operatorId: input.operatorId,
        });
        const bindings = await transaction.$queryRaw<{ bound: boolean }[]>`
          SELECT console_bind_operator_authorization(
            ${input.operatorId}::uuid,
            ${proof.issuedAtMs}::bigint,
            ${proof.nonce}::uuid,
            ${proof.mac}
          ) AS bound
        `;
        if (bindings[0]?.bound !== true) {
          return [];
        }
        return await transaction.$queryRaw<AuthorizationRow[]>`
          SELECT authorization_id::text, expires_at, read_mode
          FROM console_execution_mint_authorization(
            ${input.scope.type},
            ${tenantId}::uuid,
            ${locationId}::uuid,
            ${JSON.stringify(input.query)}::jsonb,
            ${input.expiresAt}::timestamptz
          )
        `;
      });
      const row = rows[0];
      if (rows.length !== 1 || row === undefined) {
        return null;
      }
      return {
        authorizationId: row.authorization_id,
        expiresAt: row.expires_at.toISOString(),
        readMode: row.read_mode,
      };
    },

    async disconnect() {
      await client.$disconnect();
    },
  };
}
