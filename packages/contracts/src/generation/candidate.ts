import { z } from "zod";

import { IdentifierDtoSchema } from "../shared/primitives.js";

export const AssertionGroundingDtoSchema = z.strictObject({
  kind: z.literal("assertion"),
  assertionId: IdentifierDtoSchema,
});

export const VerifiedContextGroundingDtoSchema = z.strictObject({
  kind: z.literal("verified-context"),
  contextKind: z.enum(["location-identity", "visit-date", "rating-sentiment"]),
  evidenceId: IdentifierDtoSchema,
});

export const ClaimGroundingDtoSchema = z.discriminatedUnion("kind", [
  AssertionGroundingDtoSchema,
  VerifiedContextGroundingDtoSchema,
]);

export const ClaimDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  text: z.string().min(1),
  segmentIds: z.array(IdentifierDtoSchema).min(1),
  grounding: z.array(ClaimGroundingDtoSchema).min(1),
});

export const UnsupportedOutputDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  text: z.string().min(1),
  reason: z.string().min(1),
  category: z.enum([
    "unsupported-proposition",
    "policy-rejected",
    "format-unsatisfiable",
    "unclassified-output",
  ]),
});

export const CandidateSegmentDtoSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("claim"),
    id: IdentifierDtoSchema,
    text: z.string().min(1),
    claimId: IdentifierDtoSchema,
  }),
  z.strictObject({
    kind: z.literal("connector"),
    id: IdentifierDtoSchema,
    text: z.string(),
  }),
  z.strictObject({
    kind: z.literal("annotation"),
    id: IdentifierDtoSchema,
    text: z.string().min(1),
    policyVersionId: IdentifierDtoSchema,
  }),
]);

export const ModelCandidateDtoSchema = z.strictObject({
  segments: z.array(CandidateSegmentDtoSchema),
  claims: z.array(ClaimDtoSchema),
});

export type ClaimDto = z.infer<typeof ClaimDtoSchema>;
export type UnsupportedOutputDto = z.infer<typeof UnsupportedOutputDtoSchema>;
export type ModelCandidateDto = z.infer<typeof ModelCandidateDtoSchema>;
