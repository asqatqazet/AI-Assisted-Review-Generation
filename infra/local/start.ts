import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";

import { qualifyLocalStaticPromptFixture } from "./static-prompt-release-fixture.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const host = process.env["REVIEW_LOCAL_HOST"] ?? "127.0.0.1";
const uiPort = process.env["REVIEW_LOCAL_UI_PORT"] ?? "5173";
const bffPort = process.env["REVIEW_LOCAL_BFF_PORT"] ?? "3000";
const contextReviewerPort =
  process.env["REVIEW_LOCAL_CONTEXT_REVIEWER_PORT"] ??
  process.env["REVIEW_LOCAL_CONTEXT_PORT"] ??
  "3001";
const contextConsolePort =
  process.env["REVIEW_LOCAL_CONTEXT_CONSOLE_PORT"] ?? "3003";
const generationPort = process.env["REVIEW_LOCAL_GENERATION_PORT"] ?? "3002";
const databaseUrl = required("DATABASE_URL");
const psqlBinary = process.env["PSQL_BIN"] ?? "psql";
const runId = randomBytes(16).toString("hex");
const localOperatorIssuer =
  process.env["REVIEW_LOCAL_OPERATOR_ISSUER"] ??
  `https://local.review.invalid/${runId}`;
const localPlatformSubject =
  process.env["REVIEW_LOCAL_PLATFORM_SUBJECT"] ?? `platform-${runId}`;
const localTenantSubject =
  process.env["REVIEW_LOCAL_TENANT_SUBJECT"] ?? `tenant-${runId}`;
const localPlatformEmail =
  process.env["REVIEW_LOCAL_PLATFORM_EMAIL"] ??
  "platform@local.review.invalid";
const localTenantEmail =
  process.env["REVIEW_LOCAL_TENANT_EMAIL"] ?? "tenant@local.review.invalid";
const localPlatformCredential =
  process.env["REVIEW_LOCAL_PLATFORM_CREDENTIAL"] ??
  randomBytes(32).toString("base64url");
const localTenantCredential =
  process.env["REVIEW_LOCAL_TENANT_CREDENTIAL"] ??
  randomBytes(32).toString("base64url");
const localOperatorAuthSecret =
  process.env["REVIEW_LOCAL_OPERATOR_AUTH_SECRET"] ??
  randomBytes(32).toString("base64url");
const consoleDatabaseAuthoritySecret = randomBytes(32).toString("hex");
const publicSourceRateHmacSecret =
  process.env["PUBLIC_SOURCE_RATE_HMAC_SECRET"] ??
  randomBytes(32).toString("base64url");
const localSourceAddress = "127.0.0.1";

const run = (command: string, args: readonly string[]): void => {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
};

const runWithInput = (
  command: string,
  args: readonly string[],
  input: string,
): void => {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    input,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
};

if (process.env["REVIEW_LOCAL_SKIP_DATABASE_BOOTSTRAP"] !== "1") {
  run("docker", ["compose", "up", "-d", "postgres"]);
}

run("pnpm", [
  "--dir",
  "packages/db",
  "exec",
  "prisma",
  "migrate",
  "deploy",
  "--schema",
  "prisma/schema.prisma",
]);
run("pnpm", [
  "--dir",
  "packages/db",
  "exec",
  "prisma",
  "db",
  "execute",
  "--file",
  "../../infra/aws/seed-student.sql",
  "--schema",
  "prisma/schema.prisma",
]);
run(psqlBinary, [
  "-X",
  "-v",
  "ON_ERROR_STOP=1",
  "-v",
  `local_issuer=${localOperatorIssuer}`,
  "-v",
  `platform_subject=${localPlatformSubject}`,
  "-v",
  `tenant_subject=${localTenantSubject}`,
  "-v",
  `platform_email=${localPlatformEmail}`,
  "-v",
  `tenant_email=${localTenantEmail}`,
  "-f",
  "infra/local/seed-console-operators.sql",
  databaseUrl,
]);

const contextRuntimePassword = randomBytes(32).toString("base64url");
const consoleControlPassword = randomBytes(32).toString("base64url");
const generationPassword = randomBytes(32).toString("base64url");
runWithInput(
  psqlBinary,
  ["-X", "-v", "ON_ERROR_STOP=1", databaseUrl],
  "BEGIN;\n" +
    "INSERT INTO console_database_authority_keys (singleton, secret, rotated_at) " +
    `VALUES (true, decode('${consoleDatabaseAuthoritySecret}', 'hex'), clock_timestamp()) ` +
    "ON CONFLICT (singleton) DO UPDATE SET " +
    "secret = EXCLUDED.secret, rotated_at = EXCLUDED.rotated_at;\n" +
    `ALTER ROLE context_runtime_svc PASSWORD '${contextRuntimePassword}';\n` +
    `ALTER ROLE console_control_svc PASSWORD '${consoleControlPassword}';\n` +
    `ALTER ROLE generation_svc PASSWORD '${generationPassword}';\n` +
    "COMMIT;\n",
);

const databaseUrlForRole = (role: string, password: string): string => {
  const roleUrl = new URL(databaseUrl);
  roleUrl.username = role;
  roleUrl.password = password;
  return roleUrl.toString();
};
const contextRuntimeDatabaseUrl = databaseUrlForRole(
  "context_runtime_svc",
  contextRuntimePassword,
);
const consoleControlDatabaseUrl = databaseUrlForRole(
  "console_control_svc",
  consoleControlPassword,
);
const generationDatabaseUrl = databaseUrlForRole(
  "generation_svc",
  generationPassword,
);

await qualifyLocalStaticPromptFixture({
  migrationDatabaseUrl: databaseUrl,
  consoleDatabaseUrl: consoleControlDatabaseUrl,
  consoleDatabaseAuthoritySecret,
  operatorId: "00000000-0000-4000-8000-000000000301",
});

const contextKeys = generateKeyPairSync("ed25519");
const consoleAuthorityKeys = generateKeyPairSync("ed25519");
const generationKeys = generateKeyPairSync("ed25519");
const pem = {
  contextPrivate: contextKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  contextPublic: contextKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  consoleAuthorityPrivate: consoleAuthorityKeys.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString(),
  consoleAuthorityPublic: consoleAuthorityKeys.publicKey
    .export({ type: "spki", format: "pem" })
    .toString(),
  generationPrivate: generationKeys.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString(),
  generationPublic: generationKeys.publicKey
    .export({ type: "spki", format: "pem" })
    .toString(),
};

const children: ChildProcess[] = [];
let stopping = false;
const childEnvironment: NodeJS.ProcessEnv = { ...process.env };
delete childEnvironment["DATABASE_URL"];
delete childEnvironment["DIRECT_URL"];
delete childEnvironment["SHADOW_DATABASE_URL"];
delete childEnvironment["CONTEXT_RUNTIME_DATABASE_URL"];
delete childEnvironment["CONSOLE_CONTROL_DATABASE_URL"];
delete childEnvironment["GENERATION_DATABASE_URL"];
delete childEnvironment["CONTEXT_WORK_PRIVATE_KEY_PEM"];
delete childEnvironment["CONTEXT_WORK_PUBLIC_KEY_PEM"];
delete childEnvironment["GENERATION_WORK_PRIVATE_KEY_PEM"];
delete childEnvironment["GENERATION_WORK_PUBLIC_KEY_PEM"];
delete childEnvironment["CONSOLE_AUTHORITY_PRIVATE_KEY_PEM"];
delete childEnvironment["CONSOLE_AUTHORITY_PUBLIC_KEY_PEM"];
delete childEnvironment["CONSOLE_DATABASE_AUTHORITY_SECRET"];
delete childEnvironment["PUBLIC_SOURCE_RATE_HMAC_SECRET"];
delete childEnvironment["REVIEW_LOCAL_OPERATOR_AUTH_SECRET"];
delete childEnvironment["REVIEW_LOCAL_PLATFORM_CREDENTIAL"];
delete childEnvironment["REVIEW_LOCAL_TENANT_CREDENTIAL"];
delete childEnvironment["REVIEW_LOCAL_OPERATOR_ISSUER"];
delete childEnvironment["REVIEW_LOCAL_PLATFORM_SUBJECT"];
delete childEnvironment["REVIEW_LOCAL_TENANT_SUBJECT"];
delete childEnvironment["REVIEW_LOCAL_PLATFORM_EMAIL"];
delete childEnvironment["REVIEW_LOCAL_TENANT_EMAIL"];
delete childEnvironment["REVIEW_LOCAL_LOGOUT_FAILURE"];
delete childEnvironment["REVIEW_LOCAL_SOURCE_ADDRESS"];

const start = (
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): ChildProcess => {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...childEnvironment, ...env },
    stdio: "inherit",
  });
  children.push(child);
  return child;
};

const stop = (exitCode: number): void => {
  if (stopping) {
    return;
  }
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
  }
  process.exitCode = exitCode;
};

const watch = (child: ChildProcess): void => {
  child.once("exit", (code, signal) => {
    if (!stopping) {
      console.error(
        `Local composition child exited (${code ?? signal ?? "unknown"})`,
      );
      stop(code ?? 1);
    }
  });
};

watch(
  start("pnpm", ["exec", "tsx", "apps/context-service/reviewer-dev.ts"], {
    PORT: contextReviewerPort,
    CONTEXT_RUNTIME_DATABASE_URL: contextRuntimeDatabaseUrl,
    CONTEXT_WORK_PRIVATE_KEY_PEM: pem.contextPrivate,
    GENERATION_WORK_PUBLIC_KEY_PEM: pem.generationPublic,
    PUBLIC_SOURCE_RATE_HMAC_SECRET: publicSourceRateHmacSecret,
    REVIEW_PROVIDER_MODE: "fake-only",
  }),
);
watch(
  start("pnpm", ["exec", "tsx", "apps/context-service/console-dev.ts"], {
    PORT: contextConsolePort,
    CONSOLE_CONTROL_DATABASE_URL: consoleControlDatabaseUrl,
    CONSOLE_AUTHORITY_PRIVATE_KEY_PEM: pem.consoleAuthorityPrivate,
    CONSOLE_DATABASE_AUTHORITY_SECRET: consoleDatabaseAuthoritySecret,
    REVIEW_PROVIDER_MODE: "fake-only",
  }),
);
watch(
  start("pnpm", ["exec", "tsx", "apps/generation-service/dev.ts"], {
    PORT: generationPort,
    GENERATION_DATABASE_URL: generationDatabaseUrl,
    CONTEXT_WORK_PUBLIC_KEY_PEM: pem.contextPublic,
    CONSOLE_AUTHORITY_PUBLIC_KEY_PEM: pem.consoleAuthorityPublic,
    GENERATION_WORK_PRIVATE_KEY_PEM: pem.generationPrivate,
    REVIEW_FAKE_DELAY_MS: process.env["REVIEW_FAKE_DELAY_MS"] ?? "0",
    REVIEW_PROVIDER_MODE: "fake-only",
  }),
);
watch(
  start("pnpm", ["exec", "tsx", "apps/web-bff/dev.ts"], {
    PORT: bffPort,
    REVIEW_CSRF_SECRET: randomBytes(32).toString("base64url"),
    REVIEW_LOCAL_OPERATOR_AUTH_SECRET: localOperatorAuthSecret,
    REVIEW_LOCAL_PLATFORM_CREDENTIAL: localPlatformCredential,
    REVIEW_LOCAL_TENANT_CREDENTIAL: localTenantCredential,
    REVIEW_LOCAL_OPERATOR_ISSUER: localOperatorIssuer,
    REVIEW_LOCAL_PLATFORM_SUBJECT: localPlatformSubject,
    REVIEW_LOCAL_TENANT_SUBJECT: localTenantSubject,
    REVIEW_LOCAL_PLATFORM_EMAIL: localPlatformEmail,
    REVIEW_LOCAL_TENANT_EMAIL: localTenantEmail,
    REVIEW_LOCAL_LOGOUT_FAILURE:
      process.env["REVIEW_LOCAL_LOGOUT_FAILURE"] ?? "0",
    REVIEW_LOCAL_SOURCE_ADDRESS: localSourceAddress,
    REVIEW_PUBLIC_ORIGIN: `http://${host}:${uiPort}`,
    CONTEXT_REVIEWER_ORIGIN: `http://127.0.0.1:${contextReviewerPort}`,
    CONTEXT_CONSOLE_ORIGIN: `http://127.0.0.1:${contextConsolePort}`,
    GENERATION_SERVICE_ORIGIN: `http://127.0.0.1:${generationPort}`,
  }),
);

console.info(
  `Local tenant Console sign-in: http://${host}:${uiPort}/auth/login?returnTo=${encodeURIComponent(`/console?localCredential=${localTenantCredential}`)}`,
);
console.info(
  `Local platform Console sign-in: http://${host}:${uiPort}/auth/login?returnTo=${encodeURIComponent(`/console?localCredential=${localPlatformCredential}`)}`,
);
watch(
  start(
    process.execPath,
    [
      "apps/web-bff/node_modules/vite/bin/vite.js",
      "apps/web-bff",
      "--config",
      "apps/web-bff/vite.config.ts",
      "--host",
      host,
      "--port",
      uiPort,
      "--strictPort",
    ],
    {
      REVIEW_LOCAL_BFF_PORT: bffPort,
      REVIEW_RELEASE_SHA: process.env["REVIEW_RELEASE_SHA"] ?? "local-e2e",
    },
  ),
);

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));

await new Promise<void>(() => undefined);
