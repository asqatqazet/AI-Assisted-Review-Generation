import { PrismaClient } from "../generated/execution-plane/index.js";

/**
 * A deliberately narrow execution-plane read adapter. The database functions
 * aggregate against the exact Tenant ids Context authorized; this module does
 * not expose Prisma or an arbitrary-query escape hatch to Generation.
 */
export interface PostgresConsoleExecutionProjectionStore {
  readOverview(authorizationId: string): Promise<unknown>;
  readAnalytics(authorizationId: string): Promise<unknown>;
  readGenerationDetail(authorizationId: string): Promise<unknown>;
  readAuditedGenerationDetail(authorizationId: string): Promise<unknown>;
  disconnect(): Promise<void>;
}

type JsonProjectionRow = { readonly projection: unknown };

const oneProjection = (
  rows: readonly JsonProjectionRow[],
  operation: string,
): unknown => {
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new Error(`${operation} returned an invalid projection`);
  }
  return rows[0].projection;
};

export function createPostgresConsoleExecutionProjectionStore({
  databaseUrl,
}: {
  readonly databaseUrl: string;
}): PostgresConsoleExecutionProjectionStore {
  if (databaseUrl.trim().length === 0) {
    throw new Error("Execution database URL is required");
  }
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  return {
    async readOverview(authorizationId) {
      const rows = await client.$queryRaw<JsonProjectionRow[]>`
        SELECT console_execution_overview(${authorizationId}::uuid) AS projection
      `;
      return oneProjection(rows, "console_execution_overview");
    },

    async readAnalytics(authorizationId) {
      const rows = await client.$queryRaw<JsonProjectionRow[]>`
        SELECT console_execution_analytics(${authorizationId}::uuid) AS projection
      `;
      return oneProjection(rows, "console_execution_analytics");
    },

    async readGenerationDetail(authorizationId) {
      const rows = await client.$queryRaw<JsonProjectionRow[]>`
        SELECT console_execution_generation_detail(${authorizationId}::uuid) AS projection
      `;
      return oneProjection(rows, "console_execution_generation_detail");
    },

    async readAuditedGenerationDetail(authorizationId) {
      const rows = await client.$queryRaw<JsonProjectionRow[]>`
        SELECT console_execution_generation_detail_audit(${authorizationId}::uuid) AS projection
      `;
      return oneProjection(rows, "console_execution_generation_detail_audit");
    },

    async disconnect() {
      await client.$disconnect();
    },
  };
}
