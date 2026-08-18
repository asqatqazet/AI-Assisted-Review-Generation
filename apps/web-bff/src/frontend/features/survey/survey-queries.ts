import { useQuery } from "@tanstack/react-query";

import type { EntryChallengeClient } from "../../entry-challenge-client.js";
import type { ReviewSessionClient } from "../../review-session-client.js";

export function useEntryChallenge(
  client: EntryChallengeClient,
  entryChallengeHandle: string,
) {
  return useQuery({
    queryKey: ["entry-challenge", entryChallengeHandle],
    queryFn: ({ signal }) => client.read(entryChallengeHandle, signal),
    retry: false,
    staleTime: 0,
  });
}

export function useReviewSession(
  client: ReviewSessionClient,
  reviewSessionHandle: string,
) {
  return useQuery({
    queryKey: ["review-session", reviewSessionHandle],
    queryFn: ({ signal }) => client.read(reviewSessionHandle, signal),
    retry: false,
    staleTime: 0,
  });
}
