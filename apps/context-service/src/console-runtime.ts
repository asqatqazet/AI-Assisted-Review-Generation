import {
  createPostgresConsoleControlPlaneStore,
  createPostgresConsoleExecutionAuthorizationStore,
  createPostgresOperatorAccessStore,
} from "@review/db/control-plane";

import { createConsoleBenchAuthorizer } from "./console/console-bench-authorizer.js";
import { createConsoleBenchAuthority } from "./console/console-bench-authority.js";
import { createConsoleReadAuthority } from "./console/console-read-authority.js";
import { createConsoleService } from "./console/console-service.js";
import { createConsoleContextFunctionHandler } from "./console-context-function.js";

export function createContextConsoleRuntime({
  consoleControlDatabaseUrl,
  consoleAuthorityPrivateKeyPem,
  consoleDatabaseAuthoritySecret,
  providerMode,
}: {
  readonly consoleControlDatabaseUrl: string;
  readonly consoleAuthorityPrivateKeyPem: string;
  readonly consoleDatabaseAuthoritySecret: string;
  readonly providerMode: "fake-only" | "paid-enabled";
}): (event: unknown) => Promise<unknown> {
  const operatorAccessStore = createPostgresOperatorAccessStore({
    databaseUrl: consoleControlDatabaseUrl,
    consoleDatabaseAuthoritySecret,
  });
  const consoleStore = createPostgresConsoleControlPlaneStore({
    databaseUrl: consoleControlDatabaseUrl,
    consoleDatabaseAuthoritySecret,
  });
  const executionAuthorizationStore =
    createPostgresConsoleExecutionAuthorizationStore({
      databaseUrl: consoleControlDatabaseUrl,
      consoleDatabaseAuthoritySecret,
    });
  const resolveAccess = async (identity: {
    readonly issuer: string;
    readonly subject: string;
    readonly email: string;
  }) => await operatorAccessStore.resolveAccess(identity);

  return createConsoleContextFunctionHandler({
    consoleService: createConsoleService({
      store: consoleStore,
      providerMode: providerMode === "fake-only" ? "fake-only" : "configured",
      readAuthority: createConsoleReadAuthority({
        consoleAuthorityPrivateKeyPem,
      }),
      executionAuthorizationStore,
      resolveAccess,
    }),
    consoleBenchAuthorizer: createConsoleBenchAuthorizer({
      store: consoleStore,
      authority: createConsoleBenchAuthority({
        consoleAuthorityPrivateKeyPem,
      }),
      resolveAccess,
    }),
    operatorService: {
      resolveAccess: async ({ identity }) => await resolveAccess(identity),
    },
  });
}
