import { InvokeCommand } from "@aws-sdk/client-lambda";
import { describe, expect, it } from "vitest";

import { createAwsLambdaJsonInvoker } from "./lambda-json-invoker.js";

describe("AWS private Lambda JSON invoker", () => {
  it("invokes only the configured qualified Function and parses its JSON result", async () => {
    let received: InvokeCommand | undefined;
    const invoker = createAwsLambdaJsonInvoker(
      {
        send: async (command) => {
          received = command;
          return {
            StatusCode: 200,
            Payload: new TextEncoder().encode(
              JSON.stringify({ operation: "prepare", status: "leased" }),
            ),
          };
        },
      },
      "arn:aws:lambda:eu-central-1:123:function:review-generation:live",
    );

    await expect(
      invoker.invoke({ operation: "private-operation" } as never),
    ).resolves.toEqual({ operation: "prepare", status: "leased" });
    expect(received).toBeInstanceOf(InvokeCommand);
    expect(received?.input).toMatchObject({
      FunctionName:
        "arn:aws:lambda:eu-central-1:123:function:review-generation:live",
      InvocationType: "RequestResponse",
      LogType: "None",
    });
    const payload = received?.input.Payload;
    if (!(payload instanceof Uint8Array)) {
      throw new Error("Expected binary Lambda invocation payload");
    }
    expect(JSON.parse(new TextDecoder().decode(payload))).toEqual({
      operation: "private-operation",
    });
  });

  it("fails closed while retaining only a safe nested error class and stable code", async () => {
    const failed = createAwsLambdaJsonInvoker(
      {
        send: async () => ({
          StatusCode: 200,
          FunctionError: "Unhandled",
          Payload: new TextEncoder().encode(
            '{"errorType":"DatabaseConnectionError","errorMessage":"secret database detail"}',
          ),
        }),
      },
      "qualified-function",
    );
    const stable = createAwsLambdaJsonInvoker(
      {
        send: async () => ({
          StatusCode: 200,
          FunctionError: "Unhandled",
          Payload: new TextEncoder().encode(
            '{"errorType":"Error","errorMessage":"GENERATION_TERMINAL_NOT_AVAILABLE"}',
          ),
        }),
      },
      "qualified-function",
    );
    const empty = createAwsLambdaJsonInvoker(
      { send: async () => ({ StatusCode: 200 }) },
      "qualified-function",
    );

    await expect(failed.invoke({ operation: "x" } as never)).rejects.toThrow(
      "PRIVATE_FUNCTION_FAILED_DATABASECONNECTIONERROR",
    );
    await expect(failed.invoke({ operation: "x" } as never)).rejects.not.toThrow(
      "secret database detail",
    );
    await expect(stable.invoke({ operation: "x" } as never)).rejects.toThrow(
      "PRIVATE_FUNCTION_FAILED_ERROR_GENERATION_TERMINAL_NOT_AVAILABLE",
    );
    await expect(empty.invoke({ operation: "x" } as never)).rejects.toThrow(
      "PRIVATE_FUNCTION_EMPTY_RESPONSE",
    );
  });
});
