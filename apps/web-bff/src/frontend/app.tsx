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
const defaultNavigate = (path: string): void => globalThis.location.assign(path);
const defaultCopyText = async (text: string): Promise<void> => {
  if (globalThis.navigator.clipboard === undefined) {
    throw new Error("CLIPBOARD_UNAVAILABLE");
  }
  await globalThis.navigator.clipboard.writeText(text);
};
const ratings = [
  { value: 1, label: "Poor" },
  { value: 2, label: "Not good" },
  { value: 3, label: "Mixed" },
  { value: 4, label: "Good" },
  { value: 5, label: "Very good" },
] as const;

function StartRoute({
  entryChallengeClient,
  navigate,
}: {
  readonly entryChallengeClient: EntryChallengeClient;
  readonly navigate: (path: string) => void;
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
          onSubmit={(event) => {
            event.preventDefault();
            if (state.rating === null || state.selectedAction === null) {
              return;
            }
            const abortController = new AbortController();
            void entryChallengeClient
              .start(
                {
                  entryChallengeHandle,
                  rating: state.rating,
                  action: state.selectedAction,
                  csrfToken,
                },
                abortController.signal,
              )
              .then(({ redirectTo }) => navigate(redirectTo))
              .catch(() => undefined);
            setState((current) =>
              transition(current, { type: "START_REQUESTED" }),
            );
          }}
        >
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
  copyText,
}: {
  readonly reviewSessionClient: ReviewSessionClient;
  readonly generationClient: GenerationClient;
  readonly newIdempotencyKey: () => string;
  readonly copyText: (text: string) => Promise<void>;
}): React.JSX.Element {
  const { reviewSessionHandle = "" } = useParams();
  const [state, setState] = useState(() =>
    createReviewSessionState(reviewSessionHandle),
  );
  const [copyStatus, setCopyStatus] = useState<
    "idle" | "copied" | "manual"
  >("idle");

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
            return;
          }
          if (event.type === "terminal" && event.status === "rejected") {
            setState((current) =>
              transitionReviewSession(current, {
                type: "GENERATION_FAILED",
                code: event.code,
                retryable: event.retryable,
              }),
            );
            return;
          }
        }
      } catch {
        if (!abortController.signal.aborted) {
          setState((current) =>
            transitionReviewSession(current, {
              type: "GENERATION_FAILED",
              code: "GENERATION_FAILED",
              retryable: true,
            }),
          );
        }
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
        <label>
          Review text
          <textarea aria-label="Review text" readOnly value={state.draft.text} />
        </label>
        <button
          type="button"
          onClick={() => {
            void copyText(state.draft.text)
              .then(() => setCopyStatus("copied"))
              .catch(() => setCopyStatus("manual"));
          }}
        >
          Copy review
        </button>
        <p role="status" aria-live="polite">
          {copyStatus === "copied"
            ? "Copied"
            : copyStatus === "manual"
              ? "Select the review text and copy it manually."
              : "Ready to copy."}
        </p>
      </main>
    );
  }

  if (state.value === "generation-failed") {
    return (
      <main>
        <p>{state.projection.locationDisplayName}</p>
        <h1>We couldn't create a draft</h1>
        <p role="alert">
          No review text was saved. You can try again or write it yourself.
        </p>
        {state.retryable ? (
          <button
            type="button"
            onClick={() =>
              setState((current) =>
                transitionReviewSession(current, {
                  type: "RETRY_REQUESTED",
                  idempotencyKey: newIdempotencyKey(),
                }),
              )
            }
          >
            Try again
          </button>
        ) : null}
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
  readonly copyText?: ((text: string) => Promise<void>) | undefined;
  readonly navigate?: ((path: string) => void) | undefined;
}

export function ReviewerApplication({
  entryChallengeClient = defaultEntryChallengeClient,
  reviewSessionClient = defaultReviewSessionClient,
  generationClient = defaultGenerationClient,
  newIdempotencyKey = () => globalThis.crypto.randomUUID(),
  copyText = defaultCopyText,
  navigate = defaultNavigate,
}: ReviewerApplicationProps = {}): React.JSX.Element {
  return (
    <Routes>
      <Route
        path="/start/:entryChallengeHandle"
        element={
          <StartRoute
            entryChallengeClient={entryChallengeClient}
            navigate={navigate}
          />
        }
      />
      <Route
        path="/review/:reviewSessionHandle"
        element={
          <ReviewRoute
            reviewSessionClient={reviewSessionClient}
            generationClient={generationClient}
            newIdempotencyKey={newIdempotencyKey}
            copyText={copyText}
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
