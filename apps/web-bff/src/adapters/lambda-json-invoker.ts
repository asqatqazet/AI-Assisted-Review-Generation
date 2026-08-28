import { InvokeCommand } from "@aws-sdk/client-lambda";

interface LambdaInvokeOutput {
  readonly StatusCode?: number | undefined;
  readonly FunctionError?: string | undefined;
  readonly Payload?: Uint8Array | undefined;
}

export interface LambdaInvokeClient {
  send(
    command: InvokeCommand,
    options?: { readonly abortSignal: AbortSignal },
  ): Promise<LambdaInvokeOutput>;
}

export interface AwsLambdaJsonInvoker {
  invoke(
    request: unknown,
    options?: { readonly signal?: AbortSignal | undefined },
  ): Promise<unknown>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const safeFunctionFailureCode = (payload: Uint8Array | undefined): string => {
  if (payload === undefined || payload.byteLength === 0) {
    return "PRIVATE_FUNCTION_FAILED";
  }
  try {
    const candidate = JSON.parse(decoder.decode(payload)) as unknown;
    if (typeof candidate !== "object" || candidate === null) {
      return "PRIVATE_FUNCTION_FAILED";
    }
    const failure = candidate as {
      readonly errorType?: unknown;
      readonly errorMessage?: unknown;
    };
    const parts = ["PRIVATE_FUNCTION_FAILED"];
    if (
      typeof failure.errorType === "string" &&
      /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(failure.errorType)
    ) {
      parts.push(failure.errorType.toUpperCase());
    }
    if (
      typeof failure.errorMessage === "string" &&
      /^[A-Z][A-Z0-9_]{2,127}$/.test(failure.errorMessage)
    ) {
      parts.push(failure.errorMessage);
    }
    return parts.join("_");
  } catch {
    return "PRIVATE_FUNCTION_FAILED";
  }
};

export function createAwsLambdaJsonInvoker(
  client: LambdaInvokeClient,
  qualifiedFunctionName: string,
): AwsLambdaJsonInvoker {
  if (qualifiedFunctionName.length === 0) {
    throw new Error("A qualified Function name is required");
  }

  return {
    async invoke(request, options) {
      const output = await client.send(
        new InvokeCommand({
          FunctionName: qualifiedFunctionName,
          InvocationType: "RequestResponse",
          LogType: "None",
          Payload: encoder.encode(JSON.stringify(request)),
        }),
        options?.signal === undefined
          ? undefined
          : { abortSignal: options.signal },
      );
      if (output.FunctionError !== undefined) {
        throw new Error(safeFunctionFailureCode(output.Payload));
      }
      if (output.Payload === undefined || output.Payload.byteLength === 0) {
        throw new Error("PRIVATE_FUNCTION_EMPTY_RESPONSE");
      }
      if (
        output.StatusCode !== undefined &&
        (output.StatusCode < 200 || output.StatusCode >= 300)
      ) {
        throw new Error("PRIVATE_FUNCTION_FAILED");
      }
      return JSON.parse(decoder.decode(output.Payload)) as unknown;
    },
  };
}
