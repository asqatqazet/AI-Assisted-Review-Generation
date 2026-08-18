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

function entryHeaderNote(entryMode: "invite" | "open-qr" | "both"): string {
  return entryMode === "open-qr" ? "Open visit" : "Invited visit";
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
        aria-label={location}
      >
        {children}
      </main>
    </div>
  );
}

function LandingRoute(): React.JSX.Element {
  return (
    <div className={styles.page}>
      <SurveyHeader brand="Review assistant" />
      <main className={styles.surveyMain}>
        <p className={styles.eyebrow}>Assisted review writing</p>
        <h1 className={styles.title}>Review assistant</h1>
        <p className={styles.lead}>
          Open the review link you were given to start. The link selects the
          correct business and location securely; this page does not ask you to
          choose a workspace.
        </p>
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
        <header className={styles.header}>
          <span className={styles.brand}>{state.context.tenantDisplayName}</span>
          <span className={styles.headerNote}>
            {entryHeaderNote(state.context.entryMode)}
          </span>
        </header>
        <main className={styles.surveyMain}>
        <p className={styles.eyebrow}>
          Review · {state.context.locationDisplayName}
        </p>
        <h1 className={`${styles.title} ${styles.entryTitle}`}>
          Write your review of {state.context.tenantDisplayName}
        </h1>
        <p className={styles.lead}>
          Thanks for visiting {state.context.locationDisplayName}.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const submitter = (event.nativeEvent as SubmitEvent).submitter;
            const action =
              submitter instanceof HTMLButtonElement &&
              (submitter.value === "generate" || submitter.value === "paraphrase")
                ? submitter.value
                : null;
            if (state.rating === null || action === null) {
              return;
            }
            const abortController = new AbortController();
            void entryChallengeClient
              .start(
                {
                  entryChallengeHandle,
                  rating: state.rating,
                  action,
                  csrfToken,
                },
                abortController.signal,
              )
              .then(({ redirectTo }) => navigate(redirectTo))
              .catch(() => undefined);
            setState((current) => {
              const selected = transition(current, {
                type: "ACTION_SELECTED",
                action,
              });
              return transition(selected, { type: "START_REQUESTED" });
            });
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
            <p className={styles.visuallyHidden} aria-live="polite">
              {state.rating === null
                ? "Choose a rating to continue."
                : ratings[state.rating - 1]?.label}
            </p>
          </section>
          <aside className={styles.trustNote}>
            <p className={styles.trustCopy}>
              You supply the facts. Everything on the next screens is a draft
              you read, change and copy yourself. Nothing is posted anywhere
              for you.
            </p>
          </aside>
          <section className={styles.pathSection} aria-label="Writing path">
            <div className={styles.pathCard}>
              <p className={styles.cardEyebrow}>Path one</p>
              <h3 className={styles.cardTitle}>Help me write one</h3>
              <p className={styles.cardCopy}>
                Choose the things that actually happened. The draft is built
                only from those.
              </p>
            <button
              className={styles.pathButton}
              type="submit"
              name="action"
              value="generate"
              disabled={state.rating === null}
            >
              Pick what to mention
            </button>
            </div>
            <div className={styles.pathCard}>
              <p className={styles.cardEyebrow}>Path two</p>
              <h3 className={styles.cardTitle}>I have written one</h3>
              <p className={styles.cardCopy}>
                Paste your own review. Your facts stay exactly as you wrote
                them; only the wording changes.
              </p>
            <button
              className={styles.pathButton}
              type="submit"
              name="action"
              value="paraphrase"
              disabled={state.rating === null}
            >
              Improve my wording
            </button>
            </div>
          </section>
          <p className={styles.pathHint}>
            {state.rating === null
              ? "Choose a rating first. It sets the register of the draft, and it is the one thing the assistant will not decide for you."
              : "Choose either path to continue."}
          </p>
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
  const [draftText, setDraftText] = useState("");

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
            setDraftText(event.draft.text);
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
    const groupedFacts = new Map<
      string,
      (typeof state.projection.factOptions)[number][]
    >();
    for (const factOption of state.projection.factOptions) {
      const group = groupedFacts.get(factOption.categoryLabel) ?? [];
      group.push(factOption);
      groupedFacts.set(factOption.categoryLabel, group);
    }
    const factGroups = [...groupedFacts.entries()];
    return (
      <SurveyScreen
        brand={state.projection.tenantDisplayName}
        location={state.projection.locationDisplayName}
      >
        <p className={styles.eyebrow}>What happened</p>
        <h1 className={styles.title}>What stood out?</h1>
        <p className={styles.lead}>
          Pick everything that actually happened. The order you pick them is
          the order they are written in.
        </p>
        <form className={styles.reviewForm}>
          {factGroups.map(([categoryLabel, factOptions]) => (
            <fieldset className={styles.factGroup} key={categoryLabel}>
              <legend className={styles.factGroupTitle}>{categoryLabel}</legend>
              <div className={styles.factChoices}>
                {factOptions?.map((factOption) => (
                  <label className={styles.factChoice} key={factOption.id}>
                    <input
                      className={styles.visuallyHidden}
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
          ))}
          <p className={styles.selectionCount}>
            {state.selectedFactOptionIds.length} selected · rating {state.projection.rating} of 5
          </p>
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
            Choose a format
          </button>
          <p className={styles.pathHint}>
            Pick at least one thing. The assistant will not invent the rest.
          </p>
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
        <p className={styles.eyebrow}>What happened</p>
        <h1 className={styles.title}>Pick a format</h1>
        <p className={styles.lead}>
          Formats this business has enabled, for what you are doing.
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
                  className={styles.visuallyHidden}
                  type="radio"
                  name="reviewFormatId"
                  value={format.id}
                  aria-label={format.displayName}
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
                <span className={styles.formatBody}>
                  <span className={styles.formatName}>{format.displayName}</span>
                  <span className={styles.formatDescription}>{format.description}</span>
                  <span className={styles.formatMeta}>Review format · no emoji</span>
                  <span className={styles.formatSample}>{format.sample}</span>
                </span>
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
            Write the draft
          </button>
          <p className={styles.pathHint}>
            {state.selectedReviewFormatId === null
              ? "Choose at least one format."
              : "1 format chosen."}
          </p>
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
        <p className={styles.eyebrow}>Your draft</p>
        <h1 className={styles.title}>Here it is</h1>
        <p className={styles.lead}>
          Change anything you like. Nothing leaves this page until you copy it
          yourself.
        </p>
        <section className={styles.resultCard}>
          <header className={styles.resultHeader}>
            <h2 className={styles.resultTitle}>
              {state.projection.reviewFormats.find(
                (format) => format.id === state.selectedReviewFormatId,
              )?.displayName ?? "Review"}
            </h2>
            <span className={styles.resultMeta}>
              {state.projection.action} · guarded
            </span>
          </header>
          <label className={styles.fieldLabel} htmlFor="review-text">
            Your draft — edit it freely
          </label>
          <textarea
            className={styles.reviewTextarea}
            id="review-text"
            aria-label="Review text"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
          />
          <p className={styles.characterCount}>{draftText.length} characters</p>
          <details className={styles.provenance}>
            <summary>
              What this draft is built on ({state.selectedFactOptionIds.length} facts, each traceable)
            </summary>
          </details>
          <div className={styles.resultActions}>
            <button
              className={styles.copyButton}
              type="button"
              onClick={() => {
                void copyText(draftText)
                  .then(() => setCopyStatus("copied"))
                  .catch(() => setCopyStatus("manual"));
              }}
            >
              Copy
            </button>
          </div>
          <p className={styles.status} role="status" aria-live="polite">
            {copyStatus === "copied"
              ? "Copied"
              : copyStatus === "manual"
                ? "Select the review text and copy it manually."
                : "Ready to copy."}
          </p>
        </section>
        <p className={styles.resultFootnote}>
          Copying puts the text on your clipboard. Nothing is submitted from here.
        </p>
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
      <Route path="/" element={<LandingRoute />} />
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
