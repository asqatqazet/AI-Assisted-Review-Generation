import {
  BffErrorDtoSchema,
  type BffErrorDto,
} from "@review/contracts/shared";

export class BffClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly fieldErrors: BffErrorDto["fieldErrors"];
  readonly requestId: string;

  constructor(error: BffErrorDto) {
    super(error.message);
    this.name = "BffClientError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.fieldErrors = error.fieldErrors;
    this.requestId = error.requestId;
  }
}

export async function readBffClientError(
  response: Response,
): Promise<BffClientError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const parsed = BffErrorDtoSchema.safeParse(body);
  return new BffClientError(
    parsed.success
      ? parsed.data
      : {
          code: "REQUEST_FAILED",
          message: "The request could not be completed.",
          retryable: response.status >= 500,
          requestId: response.headers.get("x-amzn-requestid") ?? "unavailable",
        },
  );
}
