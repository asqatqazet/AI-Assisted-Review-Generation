import {
  ConsoleReadInvocationResultDtoSchema,
  type ConsoleReadInvocationResultDto,
} from "@review/contracts/console-read";
import type { PostgresConsoleExecutionProjectionStore } from "@review/db/execution-plane";

import type { ConsoleExecutionReader } from "../console-read-handler.js";

const parseProjection = (value: unknown): ConsoleReadInvocationResultDto["result"] =>
  ConsoleReadInvocationResultDtoSchema.parse({
    operation: "console-read",
    result: value,
  }).result;

/** Provider output is retrieved only by the audited database projection. It
 * remains private execution evidence and is intentionally removed before the
 * ordinary Console DTO is parsed or returned to the BFF. */
const withoutPrivateProviderOutput = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const projection = value as Readonly<Record<string, unknown>>;
  const generation = projection["generation"];
  if (
    typeof generation !== "object" ||
    generation === null ||
    Array.isArray(generation)
  ) {
    return value;
  }
  const safeGeneration: Record<string, unknown> = { ...generation };
  Reflect.deleteProperty(safeGeneration, "providerOutput");
  return { ...projection, generation: safeGeneration };
};

/** Maps the signed wire query onto three fixed database projections. */
export function createPostgresConsoleExecutionReader(
  store: PostgresConsoleExecutionProjectionStore,
): ConsoleExecutionReader {
  return {
    async read(input) {
      switch (input.view) {
        case "overview":
          return parseProjection(await store.readOverview(input.authorizationId));
        case "analytics":
          return parseProjection(await store.readAnalytics(input.authorizationId));
        case "generation-detail":
          if (input.readMode === "audit") {
            return parseProjection(
              withoutPrivateProviderOutput(
                await store.readAuditedGenerationDetail(input.authorizationId),
              ),
            );
          }
          return parseProjection(
            await store.readGenerationDetail(input.authorizationId),
          );
      }
    },
  };
}
