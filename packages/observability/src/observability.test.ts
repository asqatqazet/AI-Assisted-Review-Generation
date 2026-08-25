import { describe, expect, it, vi } from "vitest";

import {
  emitGenerationMetric,
  logStructured,
  redactDraftText,
} from "./index.js";

describe("TS-20 Observability & Redaction", () => {
  it("redacts draft text and free customer input from log attributes", () => {
    const raw = {
      requestId: "req-123",
      generationId: "gen-456",
      draft: "Customer wrote private health details here.",
      freeText: "I had a painful toothache.",
      status: "completed",
    };

    const redacted = redactDraftText(raw);
    expect(redacted["requestId"]).toBe("req-123");
    expect(redacted["generationId"]).toBe("gen-456");
    expect(redacted["draft"]).toBe("[REDACTED]");
    expect(redacted["freeText"]).toBe("[REDACTED]");
    expect(redacted["status"]).toBe("completed");
  });

  it("recursively redacts capabilities, credentials and model/customer content", () => {
    const raw = {
      headers: {
        authorization: "Bearer operator-jwt",
        cookie: "__Host-review_browser=browser-secret",
      },
      invocation: {
        permit: "signed-generation-permit",
        terminalReceipt: "signed-terminal-receipt",
        snapshot: { providerRouting: { apiKey: "provider-secret" } },
      },
      attempts: [
        {
          candidateText: "unvalidated model bytes",
          assertions: [{ proposition: "private customer fact" }],
        },
      ],
      inputTokens: 150,
      outputTokens: 35,
    };

    const serialized = JSON.stringify(redactDraftText(raw));
    for (const secret of [
      "operator-jwt",
      "browser-secret",
      "signed-generation-permit",
      "signed-terminal-receipt",
      "provider-secret",
      "unvalidated model bytes",
      "private customer fact",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(JSON.parse(serialized)).toMatchObject({
      inputTokens: 150,
      outputTokens: 35,
      attempts: [
        { candidateText: "[REDACTED]", assertions: "[REDACTED]" },
      ],
    });
  });

  it("emits structured log without draft text", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logStructured({
      level: "info",
      message: "Generation completed",
      requestId: "req-789",
      generationId: "gen-101",
      draft: "Secret ungrounded text",
    });

    expect(logSpy).toHaveBeenCalled();
    const emittedString = logSpy.mock.calls[0]?.[0] as string;
    expect(emittedString).not.toContain("Secret ungrounded text");
    expect(emittedString).toContain("gen-101");
    expect(emittedString).toContain("[REDACTED]");

    logSpy.mockRestore();
  });

  it("emits EMF metrics line with required CloudWatch dimensions and metrics", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    emitGenerationMetric({
      service: "generation-service",
      tenantId: "tenant-apex",
      locationId: "loc-central",
      commandKind: "generate",
      provider: "anthropic",
      model: "claude-sonnet",
      inputTokens: 150,
      outputTokens: 35,
      costMicros: 4500,
      latencyMs: 320,
      outcome: "pass",
      fallbackUsed: false,
    });

    expect(logSpy).toHaveBeenCalled();
    const emitted = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(emitted._aws).toBeDefined();
    expect(emitted.tenantId).toBe("tenant-apex");
    expect(emitted.latencyMs).toBe(320);
    expect(emitted.costMicros).toBe(4500);

    logSpy.mockRestore();
  });
});
