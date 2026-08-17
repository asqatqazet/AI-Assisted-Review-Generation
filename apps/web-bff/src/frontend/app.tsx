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
import styles from "./app.module.css";

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

function SurveyHeader({ brand }: { readonly brand: string }): React.JSX.Element {
  return (
    <header className={styles.header}>
      <span className={styles.brand}>{brand}</span>
      <span className={styles.headerNote}>Review assistant</span>
    </header>
  );
}

function SurveyScreen({
  brand,
  location,
  busy = false,
  children,
}: {
  readonly brand: string;
  readonly location: string;
  readonly busy?: boolean | undefined;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={styles.page}>
      <SurveyHeader brand={brand} />
      <main
        className={styles.surveyMain}
        aria-busy={busy ? "true" : undefined}
      >
        <p className={styles.eyebrow}>{location}</p>
        {children}
      </main>
    </div>
  );
}

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
      <div className={styles.page}>
        <SurveyHeader brand={state.context.tenantDisplayName} />
        <main className={styles.surveyMain}>
        <p className={styles.eyebrow}>{state.context.locationDisplayName}</p>
        <h1 className={`${styles.title} ${styles.entryTitle}`}>
          Write your review of {state.context.tenantDisplayName}
        </h1>
        <p className={styles.lead}>
          A few details from you are enough to create a review you can edit and
          post yourself.
        </p>
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
          <section
            className={styles.ratingSection}
            aria-labelledby="rating-question"
          >
            <h2 className={styles.sectionTitle} id="rating-question">
              How was it?
            </h2>
            <div
              className={styles.ratingGroup}
              role="group"
              aria-label="Rating, 1 to 5"
            >
              {ratings.map((rating) => (
                <button
                  className={styles.ratingButton}
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
            <p className={styles.status} aria-live="polite">
              {state.rating === null
                ? "Choose a rating to continue."
                : ratings[state.rating - 1]?.label}
            </p>
          </section>
          <aside className={styles.trustNote}>
            <p className={styles.trustCopy}>
              Only facts you select are sent to the writing assistant. It does
              not invent details or post anything for you.
            </p>
          </aside>
          <section
            className={styles.pathSection}
            aria-labelledby="drafting-path-question"
          >
            <h2 className={styles.sectionTitle} id="drafting-path-question">
              How would you like to write?
            </h2>
            <div className={styles.pathCard}>
              <p className={styles.cardEyebrow}>Guided</p>
              <h3 className={styles.cardTitle}>Start from what happened</h3>
              <p className={styles.cardCopy}>
                Pick the facts that describe your experience and we will shape
                them into a draft.
              </p>
            <button
              className={styles.pathButton}
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
            </div>
            <div className={styles.pathCard}>
              <p className={styles.cardEyebrow}>Already written</p>
              <h3 className={styles.cardTitle}>Improve your wording</h3>
              <p className={styles.cardCopy}>
                Keep every fact you wrote while making the review clearer.
              </p>
            <button
              className={styles.pathButton}
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
            </div>
          </section>
          <button
            className={styles.primaryButton}
            type="submit"
            disabled={state.rating === null || state.selectedAction === null}
          >
            Start
          </button>
        </form>
        </main>
      </div>
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
      <SurveyScreen
        brand={state.projection.tenantDisplayName}
        location={state.projection.locationDisplayName}
      >
        <h1 className={styles.title}>What stood out?</h1>
        <p className={styles.lead}>
          Choose only the details that were true for your visit.{" "}
          <span>{state.projection.rating} out of 5</span>
        </p>
        <form className={styles.reviewForm}>
          <fieldset className={styles.choiceFieldset}>
            <legend className={styles.sectionTitle}>
              Choose the facts you want to include
            </legend>
            <div className={styles.choiceList}>
            {state.projection.factOptions.map((factOption) => (
              <label className={styles.choiceCard} key={factOption.id}>
                <input
                  className={styles.choiceControl}
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
                <span>{factOption.label}</span>
              </label>
            ))}
            </div>
          </fieldset>
          <button
            className={styles.primaryButton}
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
      </SurveyScreen>
    );
  }

  if (state.value === "format") {
    const compatibleFormats = state.projection.reviewFormats.filter((format) =>
      format.availableCommands.includes(state.projection.action),
    );
    return (
      <SurveyScreen
        brand={state.projection.tenantDisplayName}
        location={state.projection.locationDisplayName}
      >
        <h1 className={styles.title}>Choose a format</h1>
        <p className={styles.lead}>
          Each option uses the same facts you selected. Only the shape and
          length change.
        </p>
        <form className={styles.reviewForm}>
          <fieldset className={styles.choiceFieldset}>
            <legend className={styles.sectionTitle}>
              How should your review read?
            </legend>
            <div className={styles.choiceList}>
            {compatibleFormats.map((format) => (
              <label className={styles.formatCard} key={format.id}>
                <input
                  className={styles.choiceControl}
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
                <span className={styles.formatName}>{format.displayName}</span>
              </label>
            ))}
            </div>
          </fieldset>
          <button
            className={styles.primaryButton}
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
      </SurveyScreen>
    );
  }

  if (state.value === "generating") {
    return (
      <SurveyScreen
        brand={state.projection.tenantDisplayName}
        location={state.projection.locationDisplayName}
        busy
      >
        <h1 className={styles.title}>Creating your review</h1>
        <section className={styles.progressCard} aria-live="polite">
          <p className={styles.progressTitle}>Checking your draft…</p>
          <div className={styles.progressTrack} aria-hidden="true">
            <span className={styles.progressBar} />
          </div>
          <p className={styles.status} role="status">
            Only supported wording will appear in the result.
          </p>
        </section>
      </SurveyScreen>
    );
  }

  if (state.value === "results") {
    return (
      <SurveyScreen
        brand={state.projection.tenantDisplayName}
        location={state.projection.locationDisplayName}
      >
        <h1 className={styles.title}>Your review</h1>
        <p className={styles.lead}>
          This draft is built only from the facts you selected. Read it before
          copying it—you remain in control of what you post.
        </p>
        <section className={styles.resultCard}>
        <label className={styles.fieldLabel} htmlFor="review-text">
          Your draft — edit it freely
        </label>
        <textarea
          className={styles.reviewTextarea}
          id="review-text"
          aria-label="Review text"
          readOnly
          value={state.draft.text}
        />
        <button
          className={styles.primaryButton}
          type="button"
          onClick={() => {
            void copyText(state.draft.text)
              .then(() => setCopyStatus("copied"))
              .catch(() => setCopyStatus("manual"));
          }}
        >
          Copy review
        </button>
        <p className={styles.status} role="status" aria-live="polite">
          {copyStatus === "copied"
            ? "Copied"
            : copyStatus === "manual"
              ? "Select the review text and copy it manually."
              : "Ready to copy."}
        </p>
        </section>
      </SurveyScreen>
    );
  }

  if (state.value === "generation-failed") {
    return (
      <SurveyScreen
        brand={state.projection.tenantDisplayName}
        location={state.projection.locationDisplayName}
      >
        <h1 className={styles.title}>We couldn't create a draft</h1>
        <p className={styles.lead} role="alert">
          No review text was saved. You can try again or write it yourself.
        </p>
        {state.retryable ? (
          <button
            className={styles.primaryButton}
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
      </SurveyScreen>
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
