const stableDatabaseFailureCode = (error: unknown): string | undefined => {
  if (
    typeof error !== "object" ||
    error === null ||
    !("name" in error) ||
    error.name !== "PrismaClientKnownRequestError" ||
    !("code" in error) ||
    typeof error.code !== "string" ||
    !/^P[0-9]{4}$/.test(error.code)
  ) {
    return undefined;
  }
  const parts = ["DATABASE", error.code];
  if (
    "meta" in error &&
    typeof error.meta === "object" &&
    error.meta !== null &&
    "code" in error.meta &&
    typeof error.meta.code === "string" &&
    /^[0-9A-Z]{5}$/.test(error.meta.code)
  ) {
    parts.push("SQLSTATE", error.meta.code);
  }
  return parts.join("_");
};

/**
 * Keeps Lambda's public FunctionError useful without publishing Prisma's raw
 * query, relation, or connection details to an invoking service or CI log.
 */
export const createDatabaseFailureSanitizingHandler = (
  delegate: (event: unknown) => Promise<unknown>,
): ((event: unknown) => Promise<unknown>) =>
  async (event: unknown): Promise<unknown> => {
    try {
      return await delegate(event);
    } catch (error) {
      const stableCode = stableDatabaseFailureCode(error);
      if (stableCode !== undefined) {
        // eslint-disable-next-line preserve-caught-error -- raw database failures are private
        throw new Error(stableCode);
      }
      throw error;
    }
  };
