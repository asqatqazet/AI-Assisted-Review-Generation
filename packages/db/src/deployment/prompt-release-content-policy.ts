export const STUDENT_STRICT_ZERO_PROMPT_APPROVAL = {
  tenantId: "00000000-0000-4000-8000-000000000101",
  promptVersionId: "00000000-0000-4000-8000-000000000136",
  promptVersionHash:
    "sha256:faf385e0cafc00a1b456dbedaa29828486d5fc2f2da8cb16a6debf871ae4fbeb",
  action: "GENERATE",
} as const;

export function strictZeroPromptContentPolicy(input: {
  readonly tenantId: string;
  readonly promptVersionId: string;
  readonly promptVersionHash: string;
  readonly action: string;
}): "approved" | "rejected" {
  return input.tenantId === STUDENT_STRICT_ZERO_PROMPT_APPROVAL.tenantId &&
    input.promptVersionId ===
    STUDENT_STRICT_ZERO_PROMPT_APPROVAL.promptVersionId &&
    input.promptVersionHash ===
      STUDENT_STRICT_ZERO_PROMPT_APPROVAL.promptVersionHash &&
    input.action === STUDENT_STRICT_ZERO_PROMPT_APPROVAL.action
    ? "approved"
    : "rejected";
}
