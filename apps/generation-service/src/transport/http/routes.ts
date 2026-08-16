import {
  FakeModelGateway,
  type JsonObject,
  type ModelGateway,
} from "@review/llm";
import { emitGenerationMetric } from "@review/observability";
import { Hono } from "hono";

import {
  createGenerationOrchestrator,
  GroundingRejectedError,
  type GenerationOrchestrator,
  type GenerationRequest,
} from "../../application/orchestrator.js";
import type { ModelGatewayPort, ModelGatewayRequest } from "../../ports/model-gateway.port.js";
import type { TelemetryPort } from "../../ports/telemetry.port.js";

function adaptModelGateway(gateway: ModelGateway): ModelGatewayPort {
  return {
    async generate(req: ModelGatewayRequest, signal?: AbortSignal) {
      return await gateway.generate(
        {
          model: req.model,
          messages: req.messages,
          maxOutputTokens: req.maxOutputTokens,
          outputSchema: {
            name: req.outputSchema.name,
            schema: req.outputSchema.schema as unknown as JsonObject,
          },
        },
        signal,
      );
    },
  };
}

const defaultTelemetry: TelemetryPort = {
  emit(event) {
    emitGenerationMetric(event);
  },
};

export interface GenerationAppOptions {
  readonly orchestrator?: GenerationOrchestrator | undefined;
  readonly gateway?: ModelGateway | undefined;
}

export function createGenerationApp(options: GenerationAppOptions = {}): Hono {
  const gatewayPort = options.gateway ? adaptModelGateway(options.gateway) : adaptModelGateway(
    new FakeModelGateway([
      {
        outcome: "success",
        run: {
          output: { draft: "Default authentic review.", claims: [] },
          attempt: {
            provider: "fake",
            model: "fake-v1",
            usage: { inputTokens: 10, outputTokens: 5 },
            receipt: { requestId: "req-default", finishReason: "stop" },
          },
        },
      },
    ]),
  );

  const orchestrator =
    options.orchestrator ??
    createGenerationOrchestrator({
      gateway: gatewayPort,
      telemetry: defaultTelemetry,
    });

  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok", service: "generation-service" }));

  app.post("/generate", async (c) => {
    const body = (await c.req.json()) as GenerationRequest;
    try {
      const result = await orchestrator.generate(body);
      return c.json(result, 200);
    } catch (error) {
      if (error instanceof GroundingRejectedError) {
        return c.json(
          { status: "failed", code: "GROUNDING_REJECTED" },
          422,
        );
      }
      return c.json(
        {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  return app;
}
