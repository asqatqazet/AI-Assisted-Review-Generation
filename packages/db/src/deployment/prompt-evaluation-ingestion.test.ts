import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ingestPromptEvaluation,
  parsePromptEvaluationScenarios,
  type PromptEvaluationIngestionDatabase,
} from "./prompt-evaluation-ingestion.js";
import { STUDENT_STRICT_ZERO_PROMPT_APPROVAL } from "./prompt-release-content-policy.js";
import {
  loadCheckedInPromptEvaluationSuite,
  parsePromptEvaluationCliArguments,
  resolveCheckedOutReleaseSha,
} from "../../../../scripts/ingest-prompt-evaluation.js";

const temporaryRepositories: string[] = [];

afterEach(() => {
  for (const repository of temporaryRepositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

const prompt = {
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
  action: "GENERATE" as const,
  key: "tenant.generate",
  hash: "sha256:e5a156e0072551cbc9365d6d02bf5a24f82d9033a7cd3be2c42a4a87418ba739",
  body: "Use only confirmed assertions.",
  variables: ["tone", "locale"],
};

const approvedPrompt = {
  id: STUDENT_STRICT_ZERO_PROMPT_APPROVAL.promptVersionId,
  tenantId: STUDENT_STRICT_ZERO_PROMPT_APPROVAL.tenantId,
  action: "GENERATE" as const,
  key: "review.generate.release",
  hash: STUDENT_STRICT_ZERO_PROMPT_APPROVAL.promptVersionHash,
  body: "Use only supplied Assertions.",
  variables: ["locale", "tone"],
};

const suiteManifestHash =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function databaseFor(
  storedPrompt: typeof prompt | null = prompt,
): {
  readonly database: PromptEvaluationIngestionDatabase;
  readonly inserted: unknown[];
} {
  const inserted: unknown[] = [];
  return {
    inserted,
    database: {
      async transaction(work) {
        return await work({
          async assertMigrationOwner() {},
          async lockPromptVersion() {
            return storedPrompt;
          },
          async appendEvaluation(evaluation) {
            inserted.push(evaluation);
            return { status: "inserted" };
          },
        });
      },
    },
  };
}

const passingScenario = {
  id: "case-a",
  description: "A grounded Generate response passes",
  tenantId: "offline-evaluator",
  action: "generate" as const,
  reviewFormatKey: "concise-blurb",
  promptVersionKey: "tenant.generate",
  assertions: [
    {
      id: "a1",
      semanticId: "attentive-service",
      semanticKind: "experience-fact" as const,
      polarity: "positive" as const,
      text: "The service was attentive.",
    },
  ],
  mockedModelOutput: {
    draft: "The service was attentive.",
    claims: [
      {
        id: "c1",
        text: "The service was attentive.",
        assertionIds: ["a1"],
      },
    ],
  },
  expectedVerdict: "pass" as const,
  expectedMaxChars: 280,
};

const adversarialScenario = {
  ...passingScenario,
  id: "case-b",
  description: "An invented assertion is rejected",
  mockedModelOutput: {
    draft: "The service included a free upgrade.",
    claims: [
      {
        id: "c1",
        text: "The service included a free upgrade.",
        assertionIds: ["invented"],
      },
    ],
  },
  expectedVerdict: "rejected" as const,
  expectedRejectionCode: "unknown-assertion",
};

function committedSuite(): string {
  const repository = mkdtempSync(path.join(tmpdir(), "prompt-eval-suite-"));
  temporaryRepositories.push(repository);
  const suite = path.join(repository, "evals", "golden");
  mkdirSync(suite, { recursive: true });
  writeFileSync(
    path.join(suite, "01-case.json"),
    `${JSON.stringify(passingScenario, null, 2)}\n`,
  );
  execFileSync("git", ["init", "--quiet"], { cwd: repository });
  execFileSync("git", ["config", "user.name", "Release Evaluator"], {
    cwd: repository,
  });
  execFileSync("git", ["config", "user.email", "release@example.invalid"], {
    cwd: repository,
  });
  execFileSync("git", ["add", "."], { cwd: repository });
  execFileSync("git", ["commit", "--quiet", "-m", "golden suite"], {
    cwd: repository,
  });
  return repository;
}

describe("offline Prompt evaluation ingestion", () => {
  it("accepts legacy resample files without treating them as Generate evidence", () => {
    expect(
      parsePromptEvaluationScenarios([
        { ...passingScenario, id: "resample-case", action: "resample" },
      ]),
    ).toEqual([]);
  });

  it("keeps Generate qualification at nine applicable checked-in cases", () => {
    const suiteDirectory = path.resolve("evals/golden");
    const scenarios = parsePromptEvaluationScenarios(
      readdirSync(suiteDirectory)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) =>
          JSON.parse(
            readFileSync(path.join(suiteDirectory, name), "utf8"),
          ) as unknown,
        ),
    );

    expect(scenarios.filter((scenario) => scenario.action === "generate")).toHaveLength(9);
  });

  it("pins the release CLI to the repository golden suite", () => {
    expect(
      parsePromptEvaluationCliArguments([
        "node",
        "scripts/ingest-prompt-evaluation.ts",
        "--prompt-version-id",
        prompt.id,
      ]),
    ).toEqual({ promptVersionId: prompt.id });
    expect(() =>
      parsePromptEvaluationCliArguments([
        "node",
        "scripts/ingest-prompt-evaluation.ts",
        "--prompt-version-id",
        prompt.id,
        "--suite-dir",
        "/tmp/one-case-suite",
      ]),
    ).toThrow("PROMPT_EVALUATION_SUITE_OVERRIDE_FORBIDDEN");
  });

  it("uses only a clean checked-out commit that matches the declared release", () => {
    const git = {
      head: () => "abcdef0123456789abcdef0123456789abcdef01\n",
      isClean: () => true,
    };

    expect(
      resolveCheckedOutReleaseSha(
        "abcdef0123456789abcdef0123456789abcdef01",
        git,
      ),
    ).toBe("abcdef0123456789abcdef0123456789abcdef01");
    expect(() =>
      resolveCheckedOutReleaseSha(
        "1111111111111111111111111111111111111111",
        git,
      ),
    ).toThrow("PROMPT_EVALUATION_RELEASE_SHA_MISMATCH");
    expect(() =>
      resolveCheckedOutReleaseSha(undefined, {
        ...git,
        isClean: () => false,
      }),
    ).toThrow("PROMPT_EVALUATION_WORKTREE_NOT_CLEAN");
  });

  it("loads the fixed suite only when every JSON byte is tracked at HEAD", () => {
    const repository = committedSuite();
    const loaded = loadCheckedInPromptEvaluationSuite(repository);

    expect(loaded.scenarios).toEqual([passingScenario]);
    expect(loaded.manifestHash).toMatch(/^sha256:[0-9a-f]{64}$/u);

    writeFileSync(
      path.join(repository, "evals", "golden", "02-resample.json"),
      `${JSON.stringify({
        ...passingScenario,
        id: "legacy-resample",
        action: "resample",
      })}\n`,
    );
    execFileSync("git", ["add", "evals/golden/02-resample.json"], {
      cwd: repository,
    });
    execFileSync("git", ["commit", "--quiet", "-m", "bind legacy case"], {
      cwd: repository,
    });
    const withLegacyResample = loadCheckedInPromptEvaluationSuite(repository);
    expect(withLegacyResample.scenarios).toEqual([passingScenario]);
    expect(withLegacyResample.manifestHash).not.toBe(loaded.manifestHash);

    writeFileSync(path.join(repository, ".gitignore"), "evals/golden/ignored.json\n");
    execFileSync("git", ["add", ".gitignore"], { cwd: repository });
    execFileSync("git", ["commit", "--quiet", "-m", "ignore decoy"], {
      cwd: repository,
    });
    writeFileSync(
      path.join(repository, "evals", "golden", "ignored.json"),
      `${JSON.stringify(adversarialScenario)}\n`,
    );

    expect(() => loadCheckedInPromptEvaluationSuite(repository)).toThrow(
      "PROMPT_EVALUATION_SUITE_CONTAINS_UNTRACKED_JSON",
    );
  });

  it("rejects an ignored symlink escape in the fixed suite", () => {
    const repository = committedSuite();
    writeFileSync(path.join(repository, ".gitignore"), "evals/golden/escape.json\n");
    execFileSync("git", ["add", ".gitignore"], { cwd: repository });
    execFileSync("git", ["commit", "--quiet", "-m", "ignore decoy"], {
      cwd: repository,
    });
    symlinkSync(
      path.join(repository, "evals", "golden", "01-case.json"),
      path.join(repository, "evals", "golden", "escape.json"),
    );

    expect(() => loadCheckedInPromptEvaluationSuite(repository)).toThrow(
      "PROMPT_EVALUATION_SUITE_SYMLINK_FORBIDDEN",
    );
  });

  it("binds one exact immutable Prompt and the checked-out release into canonical append-only evidence", async () => {
    const { database, inserted } = databaseFor(approvedPrompt);

    const result = await ingestPromptEvaluation(database, {
      promptVersionId: approvedPrompt.id,
      evaluatorReleaseSha: "abcdef0123456789abcdef0123456789abcdef01",
      suiteName: "grounding-release-v1",
      suiteManifestHash,
      scenarios: [adversarialScenario, passingScenario],
      evaluatedAt: "2026-08-24T12:00:00.000Z",
    });

    expect(result.report).toEqual({
      schemaVersion: 1,
      evaluatorReleaseSha: "abcdef0123456789abcdef0123456789abcdef01",
      evaluatedAt: "2026-08-24T12:00:00.000Z",
      promptVersion: {
        id: approvedPrompt.id,
        tenantId: approvedPrompt.tenantId,
        action: "GENERATE",
        key: approvedPrompt.key,
        hash: approvedPrompt.hash,
        body: approvedPrompt.body,
        variables: approvedPrompt.variables,
      },
      suite: {
        kind: "deterministic-compose-request-grounding-gate",
        name: "grounding-release-v1",
        manifestHash: suiteManifestHash,
        providerBehaviorMeasured: false,
        cases: [
          {
            id: "case-a",
            scenarioHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
            composedRequestHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
            passed: true,
          },
          {
            id: "case-b",
            scenarioHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
            composedRequestHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
            passed: true,
          },
        ],
      },
    });
    expect(result.reportHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.parse(result.reportCanonical)).toEqual(result.report);
    expect(inserted).toEqual([
      {
        tenantId: approvedPrompt.tenantId,
        promptVersionId: approvedPrompt.id,
        promptVersionHash: approvedPrompt.hash,
        reportHash: result.reportHash,
        evaluatedCases: 2,
        passedCases: 2,
        evaluatorReleaseSha: "abcdef0123456789abcdef0123456789abcdef01",
        evaluatedAt: "2026-08-24T12:00:00.000Z",
        suiteName: "grounding-release-v1",
        suiteManifestHash,
        reportDocument: result.report,
        reportCanonical: result.reportCanonical,
      },
    ]);
  });

  it("does not turn a perfect deterministic report into approval for arbitrary Prompt content in any Tenant", async () => {
    const unapproved = databaseFor({
      ...prompt,
      tenantId: STUDENT_STRICT_ZERO_PROMPT_APPROVAL.tenantId,
    });
    const input = {
      promptVersionId: prompt.id,
      evaluatorReleaseSha: "abcdef0123456789abcdef0123456789abcdef01",
      suiteName: "grounding-release-v1",
      suiteManifestHash,
      scenarios: [passingScenario],
      evaluatedAt: "2026-08-24T12:00:00.000Z",
    };

    await expect(
      ingestPromptEvaluation(unapproved.database, input),
    ).rejects.toThrow("STRICT_ZERO_PROMPT_CONTENT_NOT_APPROVED");
    expect(unapproved.inserted).toEqual([]);

    const crossTenant = databaseFor(prompt);
    await expect(
      ingestPromptEvaluation(crossTenant.database, input),
    ).rejects.toThrow("STRICT_ZERO_PROMPT_CONTENT_NOT_APPROVED");
    expect(crossTenant.inserted).toEqual([]);

    const approved = databaseFor(approvedPrompt);
    await expect(
      ingestPromptEvaluation(approved.database, {
        ...input,
        promptVersionId: approvedPrompt.id,
      }),
    ).resolves.toMatchObject({ status: "inserted" });
  });

  it("rejects a non-canonical stored Prompt before evaluating or writing evidence", async () => {
    const { database, inserted } = databaseFor({
      ...prompt,
      body: "A different Prompt body.",
    });

    await expect(
      ingestPromptEvaluation(database, {
        promptVersionId: prompt.id,
        evaluatorReleaseSha: "abcdef0123456789abcdef0123456789abcdef01",
        suiteName: "grounding-release-v1",
        suiteManifestHash,
        scenarios: [passingScenario],
        evaluatedAt: "2026-08-24T12:00:00.000Z",
      }),
    ).rejects.toThrow("PROMPT_EVALUATION_PROMPT_NOT_CANONICAL");
    expect(inserted).toEqual([]);
  });

  it("requires a real 40-character release SHA and a non-empty unique suite", async () => {
    const { database } = databaseFor();
    const input = {
      promptVersionId: prompt.id,
      evaluatorReleaseSha: "local-e2e",
      suiteName: "grounding-release-v1",
      suiteManifestHash,
      scenarios: [
        { ...passingScenario, id: "same" },
        { ...adversarialScenario, id: "same" },
      ],
      evaluatedAt: "2026-08-24T12:00:00.000Z",
    };

    await expect(ingestPromptEvaluation(database, input)).rejects.toThrow(
      "PROMPT_EVALUATION_RELEASE_SHA_INVALID",
    );
    await expect(
      ingestPromptEvaluation(database, {
        ...input,
        evaluatorReleaseSha: "abcdef0123456789abcdef0123456789abcdef01",
      }),
    ).rejects.toThrow("PROMPT_EVALUATION_SCENARIO_IDS_NOT_UNIQUE");
  });
});
