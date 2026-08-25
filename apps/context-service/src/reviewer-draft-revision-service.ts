import type {
  PrepareReviewerDraftRevisionInvocationDto,
  PrepareReviewerDraftRevisionInvocationResultDto,
} from "@review/contracts/context";
import type { ReviewerDraftRevisionScopeDto } from "@review/contracts/generation";
import type { PostgresReviewSessionReader } from "@review/db/admission";

type ReviewSessionReader = Pick<PostgresReviewSessionReader, "read">;

export interface ContextDraftRevisionAuthority {
  signDraftRevisionPermit(input: {
    readonly permitJti: string;
    readonly expiresAt: string;
    readonly scope: ReviewerDraftRevisionScopeDto;
  }): Promise<string>;
}

export function createReviewerDraftRevisionService({
  reader,
  authority,
  hashCapability,
  newPermitJti,
  now = () => new Date(),
}: {
  readonly reader: ReviewSessionReader;
  readonly authority: ContextDraftRevisionAuthority;
  readonly hashCapability: (value: string) => Promise<string>;
  readonly newPermitJti: () => string;
  readonly now?: () => Date;
}): {
  prepareReviewerDraftRevision(
    input: PrepareReviewerDraftRevisionInvocationDto["input"],
  ): Promise<PrepareReviewerDraftRevisionInvocationResultDto["result"]>;
} {
  return {
    async prepareReviewerDraftRevision(input) {
      const stored = await reader.read({
        routeHandleHash: await hashCapability(input.reviewSessionHandle),
        browserCapabilityHash: await hashCapability(input.browserCapability),
      });
      if (stored === null) {
        return { status: "rejected" };
      }

      const scope: ReviewerDraftRevisionScopeDto = {
        tenantId: stored.tenantId,
        locationId: stored.locationId,
        reviewSessionId: stored.reviewSessionId,
        draftId: input.draftId,
        generationId: input.generationId,
        expectedRevision: input.expectedRevision,
        textHash: input.textHash,
        idempotencyKey: input.idempotencyKey,
      };
      return {
        status: "authorized",
        permit: await authority.signDraftRevisionPermit({
          permitJti: newPermitJti(),
          expiresAt: new Date(now().getTime() + 60_000).toISOString(),
          scope,
        }),
        scope,
      };
    },
  };
}
