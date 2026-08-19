import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";

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
const contextPort = process.env["REVIEW_LOCAL_CONTEXT_PORT"] ?? "3001";
const generationPort = process.env["REVIEW_LOCAL_GENERATION_PORT"] ?? "3002";
const databaseUrl = required("DATABASE_URL");

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

const contextKeys = generateKeyPairSync("ed25519");
const generationKeys = generateKeyPairSync("ed25519");
const pem = {
  contextPrivate: contextKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  contextPublic: contextKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  generationPrivate: generationKeys.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString(),
  generationPublic: generationKeys.publicKey
    .export({ type: "spki", format: "pem" })
    .toString(),
};

const children: ChildProcess[] = [];
let stopping = false;

const start = (
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): ChildProcess => {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
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
  start("pnpm", ["exec", "tsx", "apps/context-service/dev.ts"], {
    PORT: contextPort,
    CONTEXT_DATABASE_URL: databaseUrl,
    CONTEXT_WORK_PRIVATE_KEY_PEM: pem.contextPrivate,
    GENERATION_WORK_PUBLIC_KEY_PEM: pem.generationPublic,
    REVIEW_PUBLIC_ORIGIN: `http://${host}:${uiPort}`,
  }),
);
watch(
  start("pnpm", ["exec", "tsx", "apps/generation-service/dev.ts"], {
    PORT: generationPort,
    GENERATION_DATABASE_URL: databaseUrl,
    CONTEXT_WORK_PUBLIC_KEY_PEM: pem.contextPublic,
    GENERATION_WORK_PRIVATE_KEY_PEM: pem.generationPrivate,
    REVIEW_FAKE_DELAY_MS: process.env["REVIEW_FAKE_DELAY_MS"] ?? "0",
  }),
);
watch(
  start("pnpm", ["exec", "tsx", "apps/web-bff/dev.ts"], {
    PORT: bffPort,
    REVIEW_CSRF_SECRET: randomBytes(32).toString("base64url"),
    REVIEW_PUBLIC_ORIGIN: `http://${host}:${uiPort}`,
    CONTEXT_SERVICE_ORIGIN: `http://127.0.0.1:${contextPort}`,
    GENERATION_SERVICE_ORIGIN: `http://127.0.0.1:${generationPort}`,
  }),
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
    { REVIEW_LOCAL_BFF_PORT: bffPort },
  ),
);

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));

await new Promise<void>(() => undefined);
