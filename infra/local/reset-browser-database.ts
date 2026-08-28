import { resetIntegrationDatabase } from "../../packages/db/src/test-support/reset-integration-database.js";

const databaseUrl = process.env["DATABASE_URL"];
if (
  process.env["REVIEW_LOCAL_RESET_DATABASE"] !== "1" ||
  databaseUrl === undefined
) {
  throw new Error("LOCAL_BROWSER_DATABASE_RESET_NOT_EXPLICITLY_AUTHORIZED");
}

const parsed = new URL(databaseUrl);
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const databaseName = decodeURIComponent(parsed.pathname.slice(1));
if (
  !loopbackHosts.has(parsed.hostname) ||
  databaseName === "" ||
  new Set(["postgres", "template0", "template1"]).has(databaseName)
) {
  throw new Error("LOCAL_BROWSER_DATABASE_RESET_REQUIRES_ISOLATED_LOOPBACK_DB");
}

await resetIntegrationDatabase({
  databaseUrl,
  psql: process.env["PSQL_BIN"] ?? "psql",
});
