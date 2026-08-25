import { PrismaClient } from "../generated/execution-plane/index.js";

/** Local-composition diagnostic. Production handlers never import this module. */
export async function readExecutionPlaneDatabaseCurrentUser({
  databaseUrl,
}: {
  readonly databaseUrl: string;
}): Promise<string> {
  const client = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const rows = await client.$queryRaw<{ readonly current_user: string }[]>`
      SELECT current_user::text
    `;
    const currentUser = rows[0]?.current_user;
    if (currentUser === undefined) {
      throw new Error("Execution-plane database did not report its current role");
    }
    return currentUser;
  } finally {
    await client.$disconnect();
  }
}
