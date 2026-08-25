import type { GenerationWorkloadDto } from "@review/contracts/generation";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { handler } from "./main.js";
import { createAssessmentFakeGateway } from "./runtime.js";

describe("US-01.3 Generation production composition", () => {
  it("exports a Lambda handler instead of a development HTTP app", () => {
    expect(handler).toBeTypeOf("function");
    const source = fs.readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const referencedEnvironmentKeys = [
      ...source.matchAll(
        /(?:required\(|requiredParameter\(|process\.env\[)["']([^"']+)["']/g,
      ),
    ].map((match) => match[1]);
    expect(new Set(referencedEnvironmentKeys)).toEqual(
      new Set([
        "GENERATION_DATABASE_URL_PARAMETER",
        "CONTEXT_WORK_PUBLIC_KEY_PARAMETER",
        "CONSOLE_AUTHORITY_PUBLIC_KEY_PEM_PARAMETER",
        "GENERATION_WORK_PRIVATE_KEY_PARAMETER",
        "REVIEW_PROVIDER_MODE",
        "REVIEW_FAKE_DELAY_MS",
      ]),
    );
    expect(source).toContain("GetParameterCommand");
    expect(source).toContain("WithDecryption: true");
    expect(source).not.toMatch(/required\(["'](?:DATABASE_URL|.*KEY_B64)["']/);
    expect(source).not.toMatch(/PRIMARY_PROVIDER|MODEL|PROMPT|FORMAT|PRICE|SNAPSHOT/);
    expect(source).toMatch(
      /providerMode === "paid-enabled"[\s\S]*?optionalParameter\("GEMINI_API_KEY_PARAMETER"\)/u,
    );
    const runtimeSource = fs.readFileSync(
      new URL("./runtime.ts", import.meta.url),
      "utf8",
    );
    expect(runtimeSource).toMatch(
      /createGenerationEd25519WorkAuthority\(\{[\s\S]*?contextPublicKeyPem/u,
    );
    expect(runtimeSource).toContain(
      "createConsoleReadVerifier({ consoleAuthorityPublicKeyPem })",
    );
    expect(runtimeSource).toContain(
      "createConsoleBenchVerifier({ consoleAuthorityPublicKeyPem })",
    );
  });

  it("creates deterministic grounded FakeProvider output from the supplied workload", async () => {
    const workload = {
      bindings: { generationId: "generation-a" },
      snapshot: {
        providerRouting: {
          primaryProvider: "fake",
          primaryModel: "fake-v1",
        },
      },
      assertions: [
        {
          id: "assertion-a",
          semanticId: "fact-a",
          semanticKind: "experience-fact",
          polarity: "positive",
          proposition: "The team was attentive.",
        },
      ],
    } as GenerationWorkloadDto;
    const gateway = createAssessmentFakeGateway(workload, { delayMs: 0 });

    await expect(
      gateway.generate({
        model: "fake-v1",
        messages: [{ role: "user", content: "bound prompt" }],
        maxOutputTokens: 350,
        outputSchema: { name: "CandidateGeneration", schema: {} },
      }),
    ).resolves.toMatchObject({
      output: {
        claims: [
          {
            text: "The team was attentive.",
            assertionIds: ["assertion-a"],
          },
        ],
      },
      attempt: {
        provider: "fake",
        model: "fake-v1",
        receipt: { finishReason: "stop" },
      },
    });
  });
});
