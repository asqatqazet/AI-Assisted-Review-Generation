import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPostgresPromptEvaluationIngestionDatabase,
  ingestPromptEvaluation,
  parsePromptEvaluationScenarios,
} from "../packages/db/src/deployment/prompt-evaluation-ingestion.js";

export interface PromptEvaluationGitReader {
  head(): string;
  isClean(): boolean;
}

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function gitText(repositoryRoot: string, arguments_: readonly string[]): string {
  return execFileSync("git", [...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const commandGit: PromptEvaluationGitReader = {
  head: () => gitText(REPOSITORY_ROOT, ["rev-parse", "HEAD"]),
  isClean: () =>
    gitText(REPOSITORY_ROOT, [
      "status",
      "--porcelain",
      "--untracked-files=all",
    ]).trim() === "",
};

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function suiteJsonPaths(
  repositoryRoot: string,
  directory: string,
): string[] {
  const repositoryRealPath = realpathSync(repositoryRoot);
  const collected: string[] = [];
  const visit = (absoluteDirectory: string): void => {
    if (lstatSync(absoluteDirectory).isSymbolicLink()) {
      throw new Error("PROMPT_EVALUATION_SUITE_SYMLINK_FORBIDDEN");
    }
    const directoryRealPath = realpathSync(absoluteDirectory);
    if (
      directoryRealPath !== repositoryRealPath &&
      !directoryRealPath.startsWith(`${repositoryRealPath}${path.sep}`)
    ) {
      throw new Error("PROMPT_EVALUATION_SUITE_PATH_ESCAPE");
    }
    for (const entry of readdirSync(absoluteDirectory, {
      withFileTypes: true,
    }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(absoluteDirectory, entry.name);
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new Error("PROMPT_EVALUATION_SUITE_SYMLINK_FORBIDDEN");
      }
      if (stat.isDirectory()) {
        visit(absolutePath);
      } else if (stat.isFile() && entry.name.endsWith(".json")) {
        collected.push(
          path.relative(repositoryRoot, absolutePath).split(path.sep).join("/"),
        );
      }
    }
  };
  visit(directory);
  return collected.sort();
}

/**
 * Loads the one release suite. It rejects ignored decoys, symlinks, dirty
 * tracked bytes, and anything that is not present verbatim in the current
 * commit before parsing JSON.
 */
export function loadCheckedInPromptEvaluationSuite(
  repositoryRoot: string = REPOSITORY_ROOT,
): {
  readonly scenarios: ReturnType<typeof parsePromptEvaluationScenarios>;
  readonly manifestHash: string;
} {
  const root = path.resolve(repositoryRoot);
  if (
    gitText(root, ["status", "--porcelain", "--untracked-files=all"]).trim() !==
    ""
  ) {
    throw new Error("PROMPT_EVALUATION_WORKTREE_NOT_CLEAN");
  }
  const suiteDirectory = path.join(root, "evals", "golden");
  const checkedOutPaths = suiteJsonPaths(root, suiteDirectory);
  const trackedPaths = gitText(root, [
    "ls-tree",
    "-r",
    "--name-only",
    "HEAD",
    "--",
    "evals/golden",
  ])
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.endsWith(".json"))
    .sort();
  const tracked = new Set(trackedPaths);
  if (checkedOutPaths.some((entry) => !tracked.has(entry))) {
    throw new Error("PROMPT_EVALUATION_SUITE_CONTAINS_UNTRACKED_JSON");
  }
  if (
    checkedOutPaths.length === 0 ||
    trackedPaths.length !== checkedOutPaths.length
  ) {
    throw new Error("PROMPT_EVALUATION_SUITE_TRACKED_FILE_MISSING");
  }
  const manifest: { readonly path: string; readonly hash: string }[] = [];
  const values = checkedOutPaths.map((relativePath) => {
    const bytes = readFileSync(path.join(root, ...relativePath.split("/")));
    const committed = execFileSync("git", ["show", `HEAD:${relativePath}`], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!bytes.equals(committed)) {
      throw new Error("PROMPT_EVALUATION_SUITE_BYTES_DO_NOT_MATCH_HEAD");
    }
    manifest.push({ path: relativePath, hash: sha256(bytes) });
    return JSON.parse(bytes.toString("utf8")) as unknown;
  });
  return {
    scenarios: parsePromptEvaluationScenarios(values),
    manifestHash: sha256(JSON.stringify(manifest)),
  };
}

export function resolveCheckedOutReleaseSha(
  declaredReleaseSha: string | undefined,
  git: PromptEvaluationGitReader = commandGit,
): string {
  if (!git.isClean()) {
    throw new Error("PROMPT_EVALUATION_WORKTREE_NOT_CLEAN");
  }
  const checkedOutReleaseSha = git.head().trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(checkedOutReleaseSha)) {
    throw new Error("PROMPT_EVALUATION_RELEASE_SHA_INVALID");
  }
  if (
    declaredReleaseSha !== undefined &&
    declaredReleaseSha.toLowerCase() !== checkedOutReleaseSha
  ) {
    throw new Error("PROMPT_EVALUATION_RELEASE_SHA_MISMATCH");
  }
  return checkedOutReleaseSha;
}

export function parsePromptEvaluationCliArguments(
  argv: readonly string[] = process.argv,
): { readonly promptVersionId: string } {
  if (argv.includes("--suite-dir")) {
    throw new Error("PROMPT_EVALUATION_SUITE_OVERRIDE_FORBIDDEN");
  }
  const promptIdIndex = argv.indexOf("--prompt-version-id");
  const promptVersionId =
    promptIdIndex < 0 ? undefined : argv[promptIdIndex + 1];
  if (promptVersionId === undefined || promptVersionId.startsWith("--")) {
    throw new Error(
      "PROMPT_EVALUATION_ARGUMENT_REQUIRED:--prompt-version-id",
    );
  }
  return { promptVersionId };
}

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    console.log(`Usage:
  DATABASE_URL=<migration-owner-url> pnpm eval:prompt -- \\
    --prompt-version-id <uuid>

The command loads the exact immutable Prompt from PostgreSQL, composes every
matching checked-in scenario with that body, re-runs the grounding gate, binds
the canonical evidence to the clean checked-out Git SHA, and appends it.

This deterministic suite does not call an LLM and does not measure provider
response quality; report evidence records providerBehaviorMeasured=false.`);
    return;
  }
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    throw new Error("PROMPT_EVALUATION_MIGRATION_DATABASE_URL_REQUIRED");
  }
  const { promptVersionId } = parsePromptEvaluationCliArguments();
  const suite = loadCheckedInPromptEvaluationSuite();
  const evaluatorReleaseSha = resolveCheckedOutReleaseSha(
    process.env["REVIEW_RELEASE_SHA"],
  );
  const database = createPostgresPromptEvaluationIngestionDatabase(databaseUrl);
  try {
    const result = await ingestPromptEvaluation(database, {
      promptVersionId,
      evaluatorReleaseSha,
      suiteName: "checked-in-compose-request-grounding-gate-v1",
      suiteManifestHash: suite.manifestHash,
      scenarios: suite.scenarios,
      evaluatedAt: new Date().toISOString(),
    });
    console.log(
      JSON.stringify({
        ok: true,
        status: result.status,
        promptVersionId,
        promptVersionHash: result.report.promptVersion.hash,
        reportHash: result.reportHash,
        evaluatorReleaseSha,
        evaluatedCases: result.report.suite.cases.length,
        passedCases: result.report.suite.cases.filter(
          (testCase) => testCase.passed,
        ).length,
      }),
    );
  } finally {
    await database.disconnect();
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  void main().catch((error: unknown) => {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    console.error(JSON.stringify({ ok: false, code }));
    process.exitCode = 1;
  });
}
