export interface HttpJsonInvoker {
  invoke(
    request: unknown,
    options?: { readonly signal?: AbortSignal | undefined },
  ): Promise<unknown>;
}

export function createHttpJsonInvoker(
  origin: string,
  fetchFn: typeof fetch = globalThis.fetch,
): HttpJsonInvoker {
  const invokeUrl = new URL("/invoke", origin);

  return {
    async invoke(request, options) {
      const response = await fetchFn(invokeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      });
      if (!response.ok) {
        throw new Error("PRIVATE_SERVICE_FAILED");
      }
      return (await response.json()) as unknown;
    },
  };
}
