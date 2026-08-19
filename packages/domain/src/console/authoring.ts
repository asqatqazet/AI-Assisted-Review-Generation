import type { PriceRate } from "../generation/index.js";

/**
 * Control-plane authoring rules: what an operator may change, and what a
 * change is allowed to do to history.
 */

export type ExperimentLifecycleStatus = "draft" | "running" | "stopped";

export type ExperimentMutation =
  | "edit-variants"
  | "edit-weights"
  | "edit-action"
  | "start"
  | "stop";

export type MutationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: ExperimentRejectionCode };

export type ExperimentRejectionCode =
  | "EXPERIMENT_RUNNING"
  | "EXPERIMENT_NOT_DRAFT"
  | "INVALID_WEIGHTS";

/**
 * ADM-AI-04. A running experiment may only be stopped: changing variants,
 * weights or the tested action mid-flight silently invalidates the results
 * already collected under the old allocation.
 */
export function decideExperimentMutation({
  status,
  mutation,
}: {
  readonly status: ExperimentLifecycleStatus;
  readonly mutation: ExperimentMutation;
}): MutationDecision {
  if (mutation === "stop") {
    return status === "running"
      ? { allowed: true }
      : { allowed: false, code: "EXPERIMENT_NOT_DRAFT" };
  }
  if (status === "running") {
    return { allowed: false, code: "EXPERIMENT_RUNNING" };
  }
  if (status === "stopped") {
    return { allowed: false, code: "EXPERIMENT_NOT_DRAFT" };
  }
  return { allowed: true };
}

export function validateVariantWeights(
  variants: readonly { readonly weightPct: number }[],
): MutationDecision {
  if (variants.length < 2) {
    return { allowed: false, code: "INVALID_WEIGHTS" };
  }
  const total = variants.reduce((sum, variant) => sum + variant.weightPct, 0);
  return total === 100
    ? { allowed: true }
    : { allowed: false, code: "INVALID_WEIGHTS" };
}

export interface PriceRateDraft {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly currency: string;
  readonly inputMicrosPerMillionTokens: number;
  readonly outputMicrosPerMillionTokens: number;
  readonly effectiveFromEpochMs: number;
}

export interface PriceRateRevision {
  /** The row to insert. Existing rows are never rewritten in place. */
  readonly inserted: PriceRate;
  /** Rows whose open interval must be closed at the new rate's start. */
  readonly closed: readonly {
    readonly id: string;
    readonly effectiveUntilEpochMs: number;
  }[];
}

export class PriceVersioningError extends Error {
  public constructor(
    public readonly code: "not-later-than-current" | "invalid-rate",
    message: string,
  ) {
    super(message);
    this.name = "PriceVersioningError";
  }
}

/**
 * ADM-PLT-03. Publishing a price appends a version and closes the previous
 * one; the superseded row stays queryable so a Generation from last month can
 * still be re-costed with the price that was actually active then.
 */
export function publishPriceRate({
  existing,
  draft,
}: {
  readonly existing: readonly PriceRate[];
  readonly draft: PriceRateDraft;
}): PriceRateRevision {
  if (
    draft.inputMicrosPerMillionTokens < 0 ||
    draft.outputMicrosPerMillionTokens < 0 ||
    draft.currency.length !== 3
  ) {
    throw new PriceVersioningError(
      "invalid-rate",
      "A published price must have a 3-letter currency and non-negative rates.",
    );
  }

  const sameModel = existing.filter(
    (rate) => rate.provider === draft.provider && rate.model === draft.model,
  );
  const latestStart = sameModel.reduce(
    (latest, rate) => Math.max(latest, rate.effectiveFromEpochMs),
    Number.NEGATIVE_INFINITY,
  );
  if (sameModel.length > 0 && draft.effectiveFromEpochMs <= latestStart) {
    throw new PriceVersioningError(
      "not-later-than-current",
      "A new price version must start after the current version.",
    );
  }

  return {
    inserted: {
      id: draft.id,
      provider: draft.provider,
      model: draft.model,
      currency: draft.currency,
      inputMicrosPerMillionTokens: draft.inputMicrosPerMillionTokens,
      outputMicrosPerMillionTokens: draft.outputMicrosPerMillionTokens,
      effectiveFromEpochMs: draft.effectiveFromEpochMs,
    },
    closed: sameModel
      .filter((rate) => rate.effectiveUntilEpochMs === undefined)
      .map((rate) => ({
        id: rate.id,
        effectiveUntilEpochMs: draft.effectiveFromEpochMs,
      })),
  };
}

/**
 * ADM-CFG-01 / ADM-AI-01. Saving publishes the next version; it never rewrites
 * the version an existing Generation already points at.
 */
export function nextPublishedVersion(
  existingVersions: readonly { readonly version: number }[],
): number {
  return (
    existingVersions.reduce((highest, row) => Math.max(highest, row.version), 0) +
    1
  );
}

export type DestinationValidation =
  | { readonly status: "valid" }
  | { readonly status: "rejected"; readonly reason: string };

/**
 * ADM-LOC-05. A destination the reviewer will be sent to has to be reachable
 * before it can be enabled, and the check belongs on the server: the Console
 * is not the only client that can save one.
 */
export function validateReviewDestination({
  platformPlaceId,
  targetUrl,
  enabled,
}: {
  readonly platformPlaceId: string;
  readonly targetUrl: string;
  readonly enabled: boolean;
}): DestinationValidation {
  if (!enabled) {
    // A disabled destination may be incomplete; nothing reads it.
    return { status: "valid" };
  }
  if (platformPlaceId.trim().length === 0) {
    return {
      status: "rejected",
      reason: "An enabled destination needs the platform's place identifier.",
    };
  }
  if (!/^https:\/\/[^\s]+$/.test(targetUrl)) {
    return {
      status: "rejected",
      reason: "The destination link must be an https:// address.",
    };
  }
  return { status: "valid" };
}

/**
 * A token-free QR only admits a reviewer where scanning is an accepted way in.
 * Invite-only venues distribute a tokenised link instead.
 */
export function qrIsUsableForEntryMode(
  entryMode: "invite" | "open-qr" | "both",
): boolean {
  return entryMode !== "invite";
}
