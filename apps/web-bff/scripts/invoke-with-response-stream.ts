import {
  InvokeWithResponseStreamCommand,
  LambdaClient,
} from "@aws-sdk/client-lambda";
import { readFile, writeFile } from "node:fs/promises";

const [functionName, payloadPath, outputPath] = process.argv.slice(2);

if (
  functionName !== "review-web-bff-stream-student" ||
  payloadPath === undefined ||
  outputPath === undefined
) {
  throw new Error("CANDIDATE_STREAM_INVOCATION_ARGUMENTS_INVALID");
}

const payload = await readFile(payloadPath);
const response = await new LambdaClient({}).send(
  new InvokeWithResponseStreamCommand({
    FunctionName: functionName,
    Qualifier: "candidate",
    Payload: payload,
  }),
);
const eventStream = response.EventStream;
if (eventStream === undefined) {
  throw new Error("CANDIDATE_STREAM_EVENT_STREAM_MISSING");
}

const chunks: Buffer[] = [];
let completed = false;
for await (const event of eventStream) {
  if (event.PayloadChunk?.Payload !== undefined) {
    chunks.push(Buffer.from(event.PayloadChunk.Payload));
  }
  if (event.InvokeComplete !== undefined) {
    completed = true;
    if (event.InvokeComplete.ErrorCode !== undefined) {
      throw new Error("CANDIDATE_STREAM_FUNCTION_FAILED");
    }
  }
}

if (!completed) {
  throw new Error("CANDIDATE_STREAM_COMPLETION_MISSING");
}
await writeFile(outputPath, Buffer.concat(chunks), { mode: 0o600 });
