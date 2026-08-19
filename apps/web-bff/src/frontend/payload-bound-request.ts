/**
 * CloudFront's Origin Access Control signs requests to a Lambda function URL
 * with SigV4 but does not hash the body itself — it signs whatever
 * `x-amz-content-sha256` the viewer sent. A POST without that header therefore
 * fails at the origin with SignatureDoesNotMatch, so every browser POST in
 * this application goes through here.
 */
const encoder = new TextEncoder();

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function sendPayloadBoundPost(
  fetchFn: typeof fetch,
  input: string,
  body: string,
  {
    contentType,
    headers = {},
    signal,
  }: {
    readonly contentType: string;
    readonly headers?: Readonly<Record<string, string>> | undefined;
    readonly signal?: AbortSignal | undefined;
  },
): Promise<Response> {
  return await fetchFn(input, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...headers,
      "Content-Type": contentType,
      "x-amz-content-sha256": await sha256Hex(body),
    },
    body,
    signal: signal ?? null,
  });
}
