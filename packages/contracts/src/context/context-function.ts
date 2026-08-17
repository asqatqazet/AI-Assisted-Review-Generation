import { z } from "zod";

import { IdentifierDtoSchema } from "../shared/primitives.js";
import { PublicSurveyContextDtoSchema } from "./public-survey-context.js";
import { ReviewSessionProjectionDtoSchema } from "./review-session.js";

const BrowserCapabilityDtoSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/);

export const PrepareEntryInvocationDtoSchema = z.strictObject({
  operation: z.literal("prepare-entry"),
  input: z.strictObject({
    tenantSlug: IdentifierDtoSchema,
    locationSlug: IdentifierDtoSchema,
    invitationToken: z.string().min(1).optional(),
    tableRef: z.string().min(1).optional(),
    browserCapability: BrowserCapabilityDtoSchema,
  }),
});

export const ReadEntryChallengeInvocationDtoSchema = z.strictObject({
  operation: z.literal("read-entry-challenge"),
  input: z.strictObject({
    entryChallengeHandle: IdentifierDtoSchema,
    browserCapability: BrowserCapabilityDtoSchema,
  }),
});

export const AdvanceEntryInvocationDtoSchema = z.strictObject({
  operation: z.literal("advance-entry"),
  input: z.strictObject({
    entryChallengeHandle: IdentifierDtoSchema,
    browserCapability: BrowserCapabilityDtoSchema,
    rating: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ]),
    action: z.enum(["generate", "paraphrase"]),
  }),
});

export const ReadReviewSessionInvocationDtoSchema = z.strictObject({
  operation: z.literal("read-review-session"),
  input: z.strictObject({
    reviewSessionHandle: IdentifierDtoSchema,
    browserCapability: BrowserCapabilityDtoSchema,
  }),
});

export const ContextFunctionInvocationDtoSchema = z.discriminatedUnion(
  "operation",
  [
    PrepareEntryInvocationDtoSchema,
    ReadEntryChallengeInvocationDtoSchema,
    AdvanceEntryInvocationDtoSchema,
    ReadReviewSessionInvocationDtoSchema,
  ],
);

export const PrepareEntryInvocationResultDtoSchema = z.strictObject({
  operation: z.literal("prepare-entry"),
  result: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("prepared"),
      entryChallengeHandle: IdentifierDtoSchema,
    }),
    z.strictObject({ status: z.literal("unavailable") }),
  ]),
});

export const ReadEntryChallengeInvocationResultDtoSchema = z.strictObject({
  operation: z.literal("read-entry-challenge"),
  result: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("ready"),
      context: PublicSurveyContextDtoSchema,
    }),
    z.strictObject({ status: z.literal("unavailable") }),
  ]),
});

export const AdvanceEntryInvocationResultDtoSchema = z.strictObject({
  operation: z.literal("advance-entry"),
  result: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("admitted"),
      reviewSessionHandle: IdentifierDtoSchema,
    }),
    z.strictObject({ status: z.literal("unavailable") }),
  ]),
});

export const ReadReviewSessionInvocationResultDtoSchema = z.strictObject({
  operation: z.literal("read-review-session"),
  result: z.union([
    ReviewSessionProjectionDtoSchema,
    z.strictObject({ status: z.literal("unavailable") }),
  ]),
});

export type ContextFunctionInvocationDto = z.infer<
  typeof ContextFunctionInvocationDtoSchema
>;
export type PrepareEntryInvocationDto = z.infer<
  typeof PrepareEntryInvocationDtoSchema
>;
export type ReadEntryChallengeInvocationDto = z.infer<
  typeof ReadEntryChallengeInvocationDtoSchema
>;
export type AdvanceEntryInvocationDto = z.infer<
  typeof AdvanceEntryInvocationDtoSchema
>;
export type ReadReviewSessionInvocationDto = z.infer<
  typeof ReadReviewSessionInvocationDtoSchema
>;
export type PrepareEntryInvocationResultDto = z.infer<
  typeof PrepareEntryInvocationResultDtoSchema
>;
export type ReadEntryChallengeInvocationResultDto = z.infer<
  typeof ReadEntryChallengeInvocationResultDtoSchema
>;
export type AdvanceEntryInvocationResultDto = z.infer<
  typeof AdvanceEntryInvocationResultDtoSchema
>;
export type ReadReviewSessionInvocationResultDto = z.infer<
  typeof ReadReviewSessionInvocationResultDtoSchema
>;
