import type {
  PrepareReviewerDispositionInvocationDto,
  PrepareReviewerDispositionInvocationResultDto,
} from "@review/contracts/context";
import type { ReviewerDispositionScopeDto } from "@review/contracts/generation";
import type { PostgresReviewSessionReader } from "@review/db/admission";

type ReviewSessionReader = Pick<PostgresReviewSessionReader, "read">;

export interface ContextDispositionAuthority {
  signDispositionPermit(input: {
    readonly permitJti: string;
    readonly expiresAt: string;
    readonly scope: ReviewerDispositionScopeDto;
  }): Promise<string>;
}

export function createReviewerDispositionService({
  reader,
  authority,
  hashCapability,
  newPermitJti,
  now = () => new Date(),
}: {
  readonly reader: ReviewSessionReader;
  readonly authority: ContextDispositionAuthority;
  readonly hashCapability: (value: string) => Promise<string>;
  readonly newPermitJti: () => string;
  readonly now?: () => Date;
}): {
  prepareReviewerDisposition(
    input: PrepareReviewerDispositionInvocationDto["input"],
  ): Promise<PrepareReviewerDispositionInvocationResultDto["result"]>;
} {
  return {
    async prepareReviewerDisposition(input) {
      const stored = await reader.read({
        routeHandleHash: await hashCapability(input.reviewSessionHandle),
        browserCapabilityHash: await hashCapability(input.browserCapability),
      });
      if (stored === null) {
        return { status: "rejected" };
      }

      const scope: ReviewerDispositionScopeDto = {
        tenantId: stored.tenantId,
        locationId: stored.locationId,
        reviewSessionId: stored.reviewSessionId,
        draftId: input.draftId,
        generationId: input.generationId,
        finalTextHash: input.finalTextHash,
        idempotencyKey: input.idempotencyKey,
      };
      const permit = await authority.signDispositionPermit({
        permitJti: newPermitJti(),
        expiresAt: new Date(now().getTime() + 60_000).toISOString(),
        scope,
      });
      return { status: "authorized", permit, scope };
    },
  };
}
