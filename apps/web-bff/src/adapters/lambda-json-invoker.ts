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
        throw new Error("PRIVATE_FUNCTION_FAILED");
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
