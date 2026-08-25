import type { CommandKind, EntryMode, Locale } from "../configuration/index.js";
import type { DraftSystemAnnotation } from "../generation/edit-distance.js";

export interface PolicyInput {
  readonly requireDisclosure: boolean;
  readonly requireVerifiedExperience: boolean;
  readonly maxReviewFormatsPerRequest: number;
  readonly bannedTerms: readonly string[];
}

export interface PolicyViolation {
  readonly term: string;
  readonly message: string;
}

export interface ApplyPolicyInput {
  readonly draft: string;
  readonly claims: readonly { readonly id: string; readonly text?: string }[];
  readonly policy: PolicyInput;
  readonly tenantName: string;
  readonly locale: Locale;
  readonly disclosurePolicyVersionId?: string | undefined;
}

export interface ApplyPolicyResult {
  readonly draft: string;
  readonly appended?: string;
  readonly systemAnnotations: readonly DraftSystemAnnotation[];
  readonly violations: readonly PolicyViolation[];
}

export interface CanRequestDraftInput {
  readonly policy: PolicyInput;
  readonly draftsThisSession: number;
}

export interface CanRequestDraftResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface RequiresVerificationInput {
  readonly policy: PolicyInput;
  readonly entryMode: EntryMode;
  readonly tokenPresent: boolean;
}

export interface ExcludedAction {
  readonly command: CommandKind;
  readonly reason: string;
}

export interface AvailableActionsInput {
  readonly tenantEnabled: readonly CommandKind[];
  readonly styleSupported: readonly CommandKind[];
}

export interface AvailableActionsResult {
  readonly available: readonly CommandKind[];
  readonly excluded: readonly ExcludedAction[];
}

export class ContradictoryPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContradictoryPolicyError";
  }
}

export function generateDisclosureNotice(tenantName: string, locale: Locale): string {
  switch (locale) {
    case "de-DE":
      return `Bewertung mit KI-Unterstützung im Auftrag von ${tenantName} erstellt.`;
    case "en-GB":
    default:
      return `Review generated with AI assistance on behalf of ${tenantName}.`;
  }
}

export function applyPolicy(input: ApplyPolicyInput): ApplyPolicyResult {
  const violations: PolicyViolation[] = [];
  const disclosurePolicyVersionId = input.disclosurePolicyVersionId?.trim();
  if (
    input.policy.requireDisclosure &&
    (disclosurePolicyVersionId === undefined ||
      disclosurePolicyVersionId.length === 0)
  ) {
    violations.push({
      term: "requireDisclosure",
      message: "Disclosure policy provenance is unavailable.",
    });
  }
  const appended =
    input.policy.requireDisclosure && disclosurePolicyVersionId !== undefined
      ? generateDisclosureNotice(input.tenantName, input.locale)
      : undefined;
  const systemAnnotations: readonly DraftSystemAnnotation[] =
    appended === undefined || disclosurePolicyVersionId === undefined
      ? []
      : [
          {
            kind: "assisted-review-disclosure",
            text: appended,
            policyVersionId: disclosurePolicyVersionId,
          },
        ];
  const draft =
    appended === undefined ? input.draft : `${input.draft}\n\n${appended}`;
  const lowerDraft = draft.toLowerCase();

  for (const term of input.policy.bannedTerms) {
    const trimmed = term.trim();
    if (trimmed.length > 0 && lowerDraft.includes(trimmed.toLowerCase())) {
      violations.push({
        term: trimmed,
        message: `Draft contains banned term: "${trimmed}"`,
      });
    }
  }

  return {
    draft,
    ...(appended === undefined ? {} : { appended }),
    systemAnnotations,
    violations,
  };
}

export function canRequestDraft(input: CanRequestDraftInput): CanRequestDraftResult {
  if (input.draftsThisSession >= input.policy.maxReviewFormatsPerRequest) {
    return {
      allowed: false,
      reason: `Maximum review formats per request (${input.policy.maxReviewFormatsPerRequest}) reached for this session.`,
    };
  }
  return { allowed: true };
}

export function requiresVerification(input: RequiresVerificationInput): boolean {
  if (input.entryMode === "open-qr" && input.policy.requireVerifiedExperience) {
    throw new ContradictoryPolicyError(
      "An open-qr venue cannot require verified experience because walk-in visits have no verifiable token.",
    );
  }

  return input.policy.requireVerifiedExperience && input.entryMode !== "open-qr";
}

export function availableActions(input: AvailableActionsInput): AvailableActionsResult {
  const tenantSet = new Set(input.tenantEnabled);
  const styleSet = new Set(input.styleSupported);

  const available: CommandKind[] = [];
  const excluded: ExcludedAction[] = [];

  const allKnownCommands: CommandKind[] = [
    "generate",
    "paraphrase",
    "reformat",
    "condense",
    "expand",
    "revise-wording",
  ];

  for (const command of allKnownCommands) {
    const inTenant = tenantSet.has(command);
    const inStyle = styleSet.has(command);

    if (inTenant && inStyle) {
      available.push(command);
    } else if (inTenant && !inStyle) {
      excluded.push({
        command,
        reason: "Not supported by the selected review format.",
      });
    } else if (!inTenant && inStyle) {
      excluded.push({
        command,
        reason: "Not enabled by the tenant.",
      });
    }
  }

  return { available, excluded };
}
