import { lazy, Suspense, useEffect, useState } from "react";
import { Route, Routes, useParams } from "react-router-dom";

import {
  createHttpEntryChallengeClient,
  type EntryChallengeClient,
} from "./entry-challenge-client.js";
import {
  createHttpGenerationClient,
  type GenerationClient,
} from "./generation-client.js";
import {
  createHttpReviewSessionClient,
  type ReviewSessionClient,
} from "./review-session-client.js";
import {
  createReviewSessionState,
  transitionReviewSession,
} from "./review-session-machine.js";
import { createSurveyState, transition, type SurveyState } from "./survey-machine.js";

const OperatorConsole = lazy(() => import("./console/operator-console.js"));
const defaultEntryChallengeClient = createHttpEntryChallengeClient();
const defaultGenerationClient = createHttpGenerationClient();
const defaultReviewSessionClient = createHttpReviewSessionClient();
const ratings = [
  { value: 1, label: "Poor" },
  { value: 2, label: "Not good" },
  { value: 3, label: "Mixed" },
  { value: 4, label: "Good" },
  { value: 5, label: "Very good" },
] as const;

function StartRoute({
  entryChallengeClient,
}: {
  readonly entryChallengeClient: EntryChallengeClient;
}): React.JSX.Element {
  const { entryChallengeHandle = "" } = useParams();
  const [state, setState] = useState<SurveyState>(() =>
    createSurveyState(entryChallengeHandle),
  );
  const [csrfToken, setCsrfToken] = useState("");

  useEffect(() => {
    const abortController = new AbortController();

    void entryChallengeClient
      .read(entryChallengeHandle, abortController.signal)
      .then((projection) => {
        setCsrfToken(projection.csrfToken);
        setState((current) =>
          transition(current, {
            type: "ENTRY_PREPARED",
            context: projection.context,
          }),
        );
      })
      .catch(() => undefined);

    return () => abortController.abort();
  }, [entryChallengeClient, entryChallengeHandle]);

  if (state.value === "entry") {
    return (
      <main>
        <p>{state.context.locationDisplayName}</p>
        <h1>Write your review of {state.context.tenantDisplayName}</h1>
        <form
          method="post"
          action={`/api/v1/entry-challenges/${encodeURIComponent(entryChallengeHandle)}/start`}
        >
          <input type="hidden" name="rating" value={state.rating ?? ""} />
          <input
            type="hidden"
            name="action"
            value={state.selectedAction ?? ""}
          />
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <section aria-labelledby="rating-question">
            <h2 id="rating-question">How was it?</h2>
            <div role="group" aria-label="Rating, 1 to 5">
              {ratings.map((rating) => (
                <button
                  key={rating.value}
                  type="button"
                  aria-label={`${rating.value}, ${rating.label}`}
                  aria-pressed={state.rating === rating.value}
                  onClick={() =>
                    setState((current) =>
                      transition(current, {
                        type: "RATING_SELECTED",
                        rating: rating.value,
                      }),
                    )
                  }
                >
                  {rating.value}
                </button>
              ))}
            </div>
            <p aria-live="polite">
              {state.rating === null
                ? "Choose a rating to continue."
                : ratings[state.rating - 1]?.label}
            </p>
          </section>
          <section aria-labelledby="drafting-path-question">
            <h2 id="drafting-path-question">How would you like to write?</h2>
            <button
              type="button"
              disabled={state.rating === null}
              aria-pressed={state.selectedAction === "generate"}
              onClick={() =>
                setState((current) =>
                  transition(current, {
                    type: "ACTION_SELECTED",
                    action: "generate",
                  }),
                )
              }
            >
              Generate from my facts
            </button>
            <button
              type="button"
              disabled={state.rating === null}
              aria-pressed={state.selectedAction === "paraphrase"}
              onClick={() =>
                setState((current) =>
                  transition(current, {
                    type: "ACTION_SELECTED",
                    action: "paraphrase",
                  }),
                )
              }
            >
              Improve my wording
            </button>
          </section>
          <button
            type="submit"
            disabled={state.rating === null || state.selectedAction === null}
          >
            Start
          </button>
        </form>
      </main>
    );
  }

  return (
    <main aria-busy="true">
      <p>Review assistant</p>
      <h1>Preparing your review</h1>
      <p role="status">Checking your secure link…</p>
    </main>
  );
}

function ReviewRoute({
  reviewSessionClient,
  generationClient,
  newIdempotencyKey,
}: {
  readonly reviewSessionClient: ReviewSessionClient;
  readonly generationClient: GenerationClient;
  readonly newIdempotencyKey: () => string;
}): React.JSX.Element {
  const { reviewSessionHandle = "" } = useParams();
  const [state, setState] = useState(() =>
    createReviewSessionState(reviewSessionHandle),
  );

  useEffect(() => {
    const abortController = new AbortController();
    void reviewSessionClient
      .read(reviewSessionHandle, abortController.signal)
      .then((projection) => {
        setState((current) =>
          transitionReviewSession(current, {
            type: "REVIEW_SESSION_LOADED",
            projection,
          }),
        );
      })
      .catch(() => undefined);
    return () => abortController.abort();
  }, [reviewSessionClient, reviewSessionHandle]);

  useEffect(() => {
    if (state.value !== "generating") {
      return undefined;
    }

    const abortController = new AbortController();
    void (async () => {
      try {
        for await (const event of generationClient.start(
          {
            reviewSessionHandle: state.reviewSessionHandle,
            idempotencyKey: state.idempotencyKey,
            factOptionIds: state.selectedFactOptionIds,
            reviewFormatId: state.selectedReviewFormatId,
          },
          abortController.signal,
        )) {
          if (event.type === "terminal" && event.status === "completed") {
            setState((current) =>
              transitionReviewSession(current, {
                type: "GENERATION_SUCCEEDED",
                draft: event.draft,
              }),
            );
          }
        }
      } catch {
        // A failure projection and retry transition belong to the next slice.
      }
    })();

    return () => abortController.abort();
  }, [generationClient, state]);

  if (state.value === "facts") {
    return (
      <main>
        <p>{state.projection.locationDisplayName}</p>
        <h1>What stood out?</h1>
        <p>{state.projection.rating} out of 5</p>
        <form>
          <fieldset>
            <legend>Choose the facts you want to include</legend>
            {state.projection.factOptions.map((factOption) => (
              <label key={factOption.id}>
                <input
                  type="checkbox"
                  name="factOptionIds"
                  value={factOption.id}
                  checked={state.selectedFactOptionIds.includes(factOption.id)}
                  onChange={() =>
                    setState((current) =>
                      transitionReviewSession(current, {
                        type: "FACT_OPTION_TOGGLED",
                        factOptionId: factOption.id,
                      }),
                    )
                  }
                />
                {factOption.label}
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            disabled={state.selectedFactOptionIds.length === 0}
            onClick={() =>
              setState((current) =>
                transitionReviewSession(current, {
                  type: "CONTINUE_REQUESTED",
                }),
              )
            }
          >
            Continue
          </button>
        </form>
      </main>
    );
  }

  if (state.value === "format") {
    const compatibleFormats = state.projection.reviewFormats.filter((format) =>
      format.availableCommands.includes(state.projection.action),
    );
    return (
      <main>
        <p>{state.projection.locationDisplayName}</p>
        <h1>Choose a format</h1>
        <form>
          <fieldset>
            <legend>How should your review read?</legend>
            {compatibleFormats.map((format) => (
              <label key={format.id}>
                <input
                  type="radio"
                  name="reviewFormatId"
                  value={format.id}
                  checked={state.selectedReviewFormatId === format.id}
                  onChange={() =>
                    setState((current) =>
                      transitionReviewSession(current, {
                        type: "REVIEW_FORMAT_SELECTED",
                        reviewFormatId: format.id,
                      }),
                    )
                  }
                />
                {format.displayName}
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            disabled={state.selectedReviewFormatId === null}
            onClick={() =>
              setState((current) =>
                transitionReviewSession(current, {
                  type: "GENERATION_REQUESTED",
                  idempotencyKey: newIdempotencyKey(),
                }),
              )
            }
          >
            Create my draft
          </button>
        </form>
      </main>
    );
  }

  if (state.value === "generating") {
    return (
      <main aria-busy="true">
        <p>{state.projection.locationDisplayName}</p>
        <h1>Creating your review</h1>
        <p role="status">Checking your draft…</p>
      </main>
    );
  }

  if (state.value === "results") {
    return (
      <main>
        <p>{state.projection.locationDisplayName}</p>
        <h1>Your review</h1>
        <p>{state.draft.text}</p>
      </main>
    );
  }

  return (
    <main aria-busy="true">
      <p>Review assistant</p>
      <h1>Your review</h1>
      <p role="status">Resuming your review…</p>
    </main>
  );
}

export interface ReviewerApplicationProps {
  readonly entryChallengeClient?: EntryChallengeClient | undefined;
  readonly reviewSessionClient?: ReviewSessionClient | undefined;
  readonly generationClient?: GenerationClient | undefined;
  readonly newIdempotencyKey?: (() => string) | undefined;
}

export function ReviewerApplication({
  entryChallengeClient = defaultEntryChallengeClient,
  reviewSessionClient = defaultReviewSessionClient,
  generationClient = defaultGenerationClient,
  newIdempotencyKey = () => globalThis.crypto.randomUUID(),
}: ReviewerApplicationProps = {}): React.JSX.Element {
  return (
    <Routes>
      <Route
        path="/start/:entryChallengeHandle"
        element={<StartRoute entryChallengeClient={entryChallengeClient} />}
      />
      <Route
        path="/review/:reviewSessionHandle"
        element={
          <ReviewRoute
            reviewSessionClient={reviewSessionClient}
            generationClient={generationClient}
            newIdempotencyKey={newIdempotencyKey}
          />
        }
      />
      <Route
        path="/console/*"
        element={
          <Suspense fallback={<p role="status">Loading operator console…</p>}>
            <OperatorConsole />
          </Suspense>
        }
      />
    </Routes>
  );
}
