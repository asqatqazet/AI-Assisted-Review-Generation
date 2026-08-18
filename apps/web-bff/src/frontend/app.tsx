import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Route, Routes, useParams } from "react-router-dom";

import {
  createHttpEntryChallengeClient,
  type EntryChallengeClient,
} from "./entry-challenge-client.js";
import {
  createHttpGenerationClient,
  GenerationTransportError,
  type GenerationClient,
} from "./generation-client.js";
import {
  createHttpReviewSessionClient,
  type ReviewSessionClient,
} from "./review-session-client.js";
import {
  createHttpReviewerDispositionClient,
  type ReviewerDispositionClient,
} from "./reviewer-disposition-client.js";
import {
  createReviewSessionState,
  transitionReviewSession,
} from "./review-session-machine.js";
import { getSurveyCopy } from "./features/survey/survey-copy.js";
import {
  useEntryChallenge,
  useReviewSession,
} from "./features/survey/survey-queries.js";
import { createSurveyState, transition, type SurveyState } from "./survey-machine.js";
import styles from "./app.module.css";

const OperatorConsole = lazy(() => import("./console/operator-console.js"));
const defaultEntryChallengeClient = createHttpEntryChallengeClient();
const defaultGenerationClient = createHttpGenerationClient();
const defaultReviewSessionClient = createHttpReviewSessionClient();
const defaultReviewerDispositionClient = createHttpReviewerDispositionClient();
const defaultNavigate = (path: string): void => globalThis.location.assign(path);
const defaultCopyText = async (text: string): Promise<void> => {
  if (globalThis.navigator.clipboard === undefined) {
    throw new Error("CLIPBOARD_UNAVAILABLE");
  }
  await globalThis.navigator.clipboard.writeText(text);
};
const ratings = [
  { value: 1 },
  { value: 2 },
  { value: 3 },
  { value: 4 },
  { value: 5 },
] as const;

function SurveyHeader({
  brand,
  locale = "en-GB",
}: {
  readonly brand: string;
  readonly locale?: string | undefined;
}): React.JSX.Element {
  const copy = getSurveyCopy(locale);
  return (
    <header className={styles.header}>
      <span className={styles.brand}>{brand}</span>
      <span className={styles.headerNote}>{copy.assistantLabel}</span>
    </header>
  );
}

function entryHeaderNote(
  entryMode: "invite" | "open-qr" | "both",
  locale: string,
): string {
  const copy = getSurveyCopy(locale);
  return entryMode === "open-qr" ? copy.openVisit : copy.invitedVisit;
}

function SurveyScreen({
  brand,
  location,
  locale,
  busy = false,
  children,
}: {
  readonly brand: string;
  readonly location: string;
  readonly locale: string;
  readonly busy?: boolean | undefined;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={styles.page}>
      <SurveyHeader brand={brand} locale={locale} />
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
  const entryChallengeQuery = useEntryChallenge(
    entryChallengeClient,
    entryChallengeHandle,
  );
  const startMutation = useMutation({
    mutationKey: ["start-review-session", entryChallengeHandle],
    mutationFn: (input: {
      readonly rating: 1 | 2 | 3 | 4 | 5;
      readonly action: "generate" | "paraphrase";
    }) =>
      entryChallengeClient.start(
        { entryChallengeHandle, csrfToken, ...input },
        new AbortController().signal,
      ),
    onSuccess: ({ redirectTo }) => navigate(redirectTo),
    onError: () =>
      setState((current) =>
        transition(current, { type: "START_FAILED" }),
      ),
  });

  useEffect(() => {
    setState(createSurveyState(entryChallengeHandle));
    setCsrfToken("");
  }, [entryChallengeHandle]);

  useEffect(() => {
    if (entryChallengeQuery.data === undefined) {
      return;
    }
    setCsrfToken(entryChallengeQuery.data.csrfToken);
    setState((current) =>
      transition(current, {
        type: "ENTRY_PREPARED",
        context: entryChallengeQuery.data.context,
      }),
    );
  }, [entryChallengeQuery.data]);

  if (state.value === "entry") {
    const copy = getSurveyCopy(state.context.locale);
    const availableActions = new Set(
      state.context.reviewFormats.flatMap((format) => format.availableCommands),
    );
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <span className={styles.brand}>{state.context.tenantDisplayName}</span>
          <span className={styles.headerNote}>
            {entryHeaderNote(state.context.entryMode, state.context.locale)}
          </span>
        </header>
        <main className={styles.surveyMain}>
        <p className={styles.eyebrow}>
          {copy.reviewLabel} · {state.context.locationDisplayName}
        </p>
        <h1 className={`${styles.title} ${styles.entryTitle}`}>
          {copy.ask(state.context.tenantDisplayName)}
        </h1>
        <p className={styles.lead}>
          {copy.acknowledgement(state.context.locationDisplayName)}
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
            startMutation.mutate({ rating: state.rating, action });
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
              {copy.ratingAsk}
            </h2>
            <div
              className={styles.ratingGroup}
              role="group"
              aria-label={copy.ratingGroupLabel}
            >
              {ratings.map((rating) => (
                <button
                  className={styles.ratingButton}
                  key={rating.value}
                  type="button"
                  aria-label={`${rating.value}, ${copy.ratingWords[rating.value - 1]}`}
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
                ? copy.chooseRating
                : copy.ratingWords[state.rating - 1]}
            </p>
          </section>
          <aside className={styles.trustNote}>
            <p className={styles.trustCopy}>
              {copy.trust}
            </p>
          </aside>
          <section
            className={styles.pathSection}
            aria-label={copy.writingPathLabel}
          >
            {availableActions.has("generate") ? (
              <div className={styles.pathCard}>
                <p className={styles.cardEyebrow}>{copy.generatePath.eyebrow}</p>
                <h3 className={styles.cardTitle}>{copy.generatePath.title}</h3>
                <p className={styles.cardCopy}>{copy.generatePath.body}</p>
                <button
                  className={styles.pathButton}
                  type="submit"
                  name="action"
                  value="generate"
                  disabled={state.rating === null}
                >
                  {copy.generatePath.cta}
                </button>
              </div>
            ) : null}
            {availableActions.has("paraphrase") ? (
              <div className={styles.pathCard}>
                <p className={styles.cardEyebrow}>{copy.paraphrasePath.eyebrow}</p>
                <h3 className={styles.cardTitle}>{copy.paraphrasePath.title}</h3>
                <p className={styles.cardCopy}>{copy.paraphrasePath.body}</p>
                <button
                  className={styles.pathButton}
                  type="submit"
                  name="action"
                  value="paraphrase"
                  disabled={state.rating === null}
                >
                  {copy.paraphrasePath.cta}
                </button>
              </div>
            ) : null}
          </section>
          {availableActions.size === 0 ? (
            <p className={styles.status} role="alert">
              {copy.assistanceUnavailable}
            </p>
          ) : null}
          <p className={styles.pathHint}>
            {state.rating === null
              ? copy.needRating
              : copy.choosePath}
          </p>
          {startMutation.isError ? (
            <p className={styles.status} role="alert">
              {copy.startFailed}
            </p>
          ) : null}
        </form>
        </main>
      </div>
    );
  }

  if (entryChallengeQuery.isError) {
    return (
      <main>
        <h1>Review link unavailable</h1>
        <p role="alert">This review link could not be opened.</p>
        <button type="button" onClick={() => void entryChallengeQuery.refetch()}>
          Try again
        </button>
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
  reviewerDispositionClient,
  newIdempotencyKey,
  copyText,
}: {
  readonly reviewSessionClient: ReviewSessionClient;
  readonly generationClient: GenerationClient;
  readonly reviewerDispositionClient: ReviewerDispositionClient;
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
  const [completedText, setCompletedText] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<{
    readonly phase: "queued" | "generating" | "validating" | "persisting";
    readonly elapsedSeconds: number;
  }>({ phase: "queued", elapsedSeconds: 0 });
  const generationAbortRef = useRef<AbortController | null>(null);
  const reviewSessionQuery = useReviewSession(
    reviewSessionClient,
    reviewSessionHandle,
  );

  useEffect(() => {
    setState(createReviewSessionState(reviewSessionHandle));
    setCopyStatus("idle");
    setDraftText("");
    setCompletedText(null);
    setGenerationProgress({ phase: "queued", elapsedSeconds: 0 });
  }, [reviewSessionHandle]);

  useEffect(() => {
    if (reviewSessionQuery.data === undefined) {
      return;
    }
    setState((current) =>
      transitionReviewSession(current, {
        type: "REVIEW_SESSION_LOADED",
        projection: reviewSessionQuery.data,
      }),
    );
  }, [reviewSessionQuery.data]);

  useEffect(() => {
    if (state.value !== "generating") {
      return undefined;
    }

    const abortController = new AbortController();
    generationAbortRef.current = abortController;
    setGenerationProgress({ phase: "queued", elapsedSeconds: 0 });
    void (async () => {
      try {
        for await (const event of generationClient.start(
          {
            reviewSessionHandle: state.reviewSessionHandle,
            idempotencyKey: state.idempotencyKey,
            factOptionIds: state.selectedFactOptionIds,
            reviewFormatId: state.selectedReviewFormatId,
            ...(state.customerAssertion.trim().length === 0
              ? {}
              : { customerAssertion: state.customerAssertion.trim() }),
          },
          abortController.signal,
        )) {
          if (event.type === "progress") {
            setGenerationProgress({
              phase: event.phase,
              elapsedSeconds: event.elapsedSeconds,
            });
          }
          if (event.type === "heartbeat") {
            setGenerationProgress((current) => ({
              ...current,
              elapsedSeconds: event.elapsedSeconds,
            }));
          }
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
      } catch (error) {
        if (!abortController.signal.aborted) {
          setState((current) =>
            transitionReviewSession(current, {
              type: "GENERATION_FAILED",
              code:
                error instanceof GenerationTransportError &&
                error.code === "EDGE_THROTTLED"
                  ? "RATE_LIMITED"
                  : "GENERATION_FAILED",
              retryable: true,
            }),
          );
        }
      }
    })();

    return () => {
      abortController.abort();
      if (generationAbortRef.current === abortController) {
        generationAbortRef.current = null;
      }
    };
  }, [generationClient, state]);

  if (state.value === "facts") {
    const copy = getSurveyCopy(state.projection.locale);
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
        locale={state.projection.locale}
      >
        <p className={styles.eyebrow}>{copy.factsEyebrow}</p>
        <h1 className={styles.title}>{copy.factsHeading}</h1>
        <p className={styles.lead}>{copy.factsLead}</p>
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
          <div className={styles.factAssertionField}>
            <label className={styles.fieldLabel} htmlFor="customer-assertion">
              {copy.optionalFactLabel}
            </label>
            <textarea
              className={`${styles.reviewTextarea} ${styles.factAssertionTextarea}`}
              id="customer-assertion"
              value={state.customerAssertion}
              maxLength={
                state.projection.requirements.maximumCustomerAssertionChars
              }
              onChange={(event) =>
                setState((current) =>
                  transitionReviewSession(current, {
                    type: "CUSTOMER_ASSERTION_CHANGED",
                    value: event.target.value,
                  }),
                )
              }
            />
            <p className={styles.characterCount}>
              {copy.charactersAgainstLimit(
                state.customerAssertion.length,
                state.projection.requirements.maximumCustomerAssertionChars,
              )}
            </p>
            <p className={styles.pathHint}>
              {copy.optionalFactHelp(
                state.projection.requirements.maximumCustomerAssertionChars,
              )}
            </p>
          </div>
          <p className={styles.selectionCount}>
            {copy.selectionCount(
              state.selectedFactOptionIds.length,
              state.projection.rating,
            )}
          </p>
          <button
            className={styles.primaryButton}
            type="button"
            disabled={
              state.selectedFactOptionIds.length <
              state.projection.requirements.minimumFactSelections
            }
            onClick={() =>
              setState((current) =>
                transitionReviewSession(current, {
                  type: "CONTINUE_REQUESTED",
                }),
              )
            }
          >
            {copy.chooseFormat}
          </button>
          <p className={styles.pathHint}>
            {copy.minimumFacts(
              state.projection.requirements.minimumFactSelections,
            )}
          </p>
        </form>
      </SurveyScreen>
    );
  }

  if (state.value === "format") {
    const copy = getSurveyCopy(state.projection.locale);
    const compatibleFormats = state.projection.reviewFormats.filter((format) =>
      format.availableCommands.includes(state.projection.action),
    );
    return (
      <SurveyScreen
        brand={state.projection.tenantDisplayName}
        location={state.projection.locationDisplayName}
        locale={state.projection.locale}
      >
        <p className={styles.eyebrow}>{copy.factsEyebrow}</p>
        <h1 className={styles.title}>{copy.formatHeading}</h1>
        <p className={styles.lead}>{copy.formatLead}</p>
        <form className={styles.reviewForm}>
          <fieldset className={styles.choiceFieldset}>
            <legend className={styles.sectionTitle}>
              {copy.formatLegend}
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
                  <span className={styles.formatMeta}>{copy.formatMeta}</span>
                  <span className={styles.formatConstraint}>
                    {copy.formatConstraints(
                      format.constraints.minChars,
                      format.constraints.maxChars,
                    )}
                  </span>
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
            {copy.writeDraft}
          </button>
          <p className={styles.pathHint}>
            {state.selectedReviewFormatId === null
              ? copy.chooseAFormat
              : copy.formatChosen}
          </p>
        </form>
      </SurveyScreen>
    );
  }

  if (state.value === "generating") {
    const copy = getSurveyCopy(state.projection.locale);
    return (
      <SurveyScreen
        brand={state.projection.tenantDisplayName}
        location={state.projection.locationDisplayName}
        locale={state.projection.locale}
        busy
      >
        <h1 className={styles.title}>{copy.generatingHeading}</h1>
        <section className={styles.progressCard} aria-live="polite">
          <p className={styles.progressTitle}>{copy.checkingDraft}</p>
          <p className={styles.progressMeta}>
            {copy.progress(
              generationProgress.phase,
              generationProgress.elapsedSeconds,
            )}
          </p>
          <div className={styles.progressTrack} aria-hidden="true">
            <span className={styles.progressBar} />
          </div>
          <p className={styles.status} role="status">
            {copy.safeOutputOnly}
          </p>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => {
              generationAbortRef.current?.abort();
              generationAbortRef.current = null;
              setState((current) =>
                transitionReviewSession(current, {
                  type: "GENERATION_FAILED",
                  code: "CANCELLED",
                  retryable: true,
                }),
              );
            }}
          >
            {copy.stopGeneration}
          </button>
        </section>
      </SurveyScreen>
    );
  }

  if (state.value === "results") {
    const copy = getSurveyCopy(state.projection.locale);
    const selectedFormat = state.projection.reviewFormats.find(
      (format) => format.id === state.selectedReviewFormatId,
    );
    const destination = state.projection.destinations.find(
      (candidate) => candidate.targetPlatform === selectedFormat?.targetPlatform,
    );
    const dirty = draftText !== state.draft.text;
    const violatesFormat =
      selectedFormat !== undefined &&
      (draftText.length < selectedFormat.constraints.minChars ||
        draftText.length > selectedFormat.constraints.maxChars);

    if (completedText !== null) {
      return (
        <SurveyScreen
          brand={state.projection.tenantDisplayName}
          location={state.projection.locationDisplayName}
          locale={state.projection.locale}
        >
          <p className={styles.eyebrow}>{copy.doneEyebrow}</p>
          <h1 className={styles.title}>{copy.doneHeading}</h1>
          <p className={styles.lead}>{copy.doneLead}</p>
          <section className={styles.resultCard}>
            <p className={styles.finalReviewText}>{completedText}</p>
            <div className={styles.resultActions}>
              <button
                className={styles.copyButton}
                type="button"
                onClick={() => {
                  void copyText(completedText)
                    .then(() => setCopyStatus("copied"))
                    .catch(() => setCopyStatus("manual"));
                }}
              >
                {copy.copyAgain}
              </button>
              {destination === undefined ? null : (
                <a
                  className={styles.destinationButton}
                  href={destination.targetUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy.openDestination(destination.displayName)}
                </a>
              )}
            </div>
            {destination === undefined ? (
              <p className={styles.status} role="status">
                {copy.noDestination}
              </p>
            ) : null}
            <button
              className={styles.textButton}
              type="button"
              onClick={() => setCompletedText(null)}
            >
              {copy.backToEdit}
            </button>
          </section>
        </SurveyScreen>
      );
    }

    return (
      <SurveyScreen
        brand={state.projection.tenantDisplayName}
        location={state.projection.locationDisplayName}
        locale={state.projection.locale}
      >
        <p className={styles.eyebrow}>{copy.resultEyebrow}</p>
        <h1 className={styles.title}>{copy.resultHeading}</h1>
        <p className={styles.lead}>{copy.resultLead}</p>
        <section className={styles.resultCard}>
          <header className={styles.resultHeader}>
            <h2 className={styles.resultTitle}>
              {selectedFormat?.displayName ?? "Review"}
            </h2>
            <span className={styles.resultMeta}>
              {copy.actionLabel(state.projection.action)} · {copy.guarded}
            </span>
          </header>
          <label className={styles.fieldLabel} htmlFor="review-text">
            {copy.editLabel}
          </label>
          <textarea
            className={styles.reviewTextarea}
            id="review-text"
            aria-label={copy.editLabel}
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
          />
          <p className={styles.characterCount}>
            {selectedFormat === undefined
              ? copy.characters(draftText.length)
              : copy.charactersAgainstLimit(
                  draftText.length,
                  selectedFormat.constraints.maxChars,
                )}
          </p>
          {dirty ? (
            <p className={styles.editedState} role="status">
              {copy.editedByYou}
            </p>
          ) : null}
          {violatesFormat && selectedFormat !== undefined ? (
            <p className={styles.constraintWarning} role="alert">
              {copy.formatWarning(
                selectedFormat.constraints.minChars,
                selectedFormat.constraints.maxChars,
              )}
            </p>
          ) : null}
          <details className={styles.provenance}>
            <summary>{copy.provenance(state.selectedFactOptionIds.length)}</summary>
          </details>
          <div className={styles.resultActions}>
            <button
              className={styles.copyButton}
              type="button"
              onClick={() => {
                void copyText(draftText)
                  .then(() => {
                    setCopyStatus("copied");
                    setCompletedText(draftText);
                    void reviewerDispositionClient
                      .record({
                        reviewSessionHandle: state.reviewSessionHandle,
                        idempotencyKey: newIdempotencyKey(),
                        draftId: state.draft.id,
                        generationId: state.draft.generationId,
                        finalText: draftText,
                      })
                      .catch(() => undefined);
                  })
                  .catch(() => setCopyStatus("manual"));
              }}
            >
              {copy.copy}
            </button>
          </div>
          <p className={styles.status} role="status" aria-live="polite">
            {copyStatus === "copied"
              ? copy.copied
              : copyStatus === "manual"
                ? copy.manualCopy
                : copy.readyToCopy}
          </p>
        </section>
        <p className={styles.resultFootnote}>
          {copy.copyFootnote}
        </p>
      </SurveyScreen>
    );
  }

  if (state.value === "generation-failed") {
    const copy = getSurveyCopy(state.projection.locale);
    const cancelled = state.code === "CANCELLED";
    const rateLimited = state.code === "RATE_LIMITED";
    const budgetUnavailable = state.code === "BUDGET_EXCEEDED";
    const groundingRejected = state.code === "GROUNDING_REJECTED";
    const formatRejected =
      state.code === "FORMAT_REJECTED" || state.code === "POLICY_REJECTED";
    const selectedFormat = state.projection.reviewFormats.find(
      (format) => format.id === state.selectedReviewFormatId,
    );
    const destination = state.projection.destinations.find(
      (candidate) => candidate.targetPlatform === selectedFormat?.targetPlatform,
    );
    const heading = cancelled
      ? copy.cancelledHeading
      : rateLimited
        ? copy.rateLimitedHeading
        : budgetUnavailable
          ? copy.budgetHeading
          : groundingRejected
            ? copy.groundingHeading
            : formatRejected
              ? copy.formatFailureHeading
              : copy.failureHeading;
    const body = cancelled
      ? copy.cancelledBody
      : rateLimited
        ? copy.rateLimitedBody
        : budgetUnavailable
          ? copy.budgetBody
          : groundingRejected
            ? copy.groundingBody
            : formatRejected
              ? copy.formatFailureBody
              : copy.failureBody;
    return (
      <SurveyScreen
        brand={state.projection.tenantDisplayName}
        location={state.projection.locationDisplayName}
        locale={state.projection.locale}
      >
        <h1 className={styles.title}>{heading}</h1>
        <p className={styles.lead} role="alert">{body}</p>
        {budgetUnavailable ? (
          <section className={styles.resultCard}>
            <label className={styles.fieldLabel} htmlFor="manual-review-text">
              {copy.manualReviewLabel}
            </label>
            <textarea
              className={styles.reviewTextarea}
              id="manual-review-text"
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
            />
            <p className={styles.characterCount}>
              {copy.characters(draftText.length)}
            </p>
            <div className={styles.resultActions}>
              <button
                className={styles.copyButton}
                type="button"
                disabled={draftText.trim().length === 0}
                onClick={() => {
                  void copyText(draftText)
                    .then(() => setCopyStatus("copied"))
                    .catch(() => setCopyStatus("manual"));
                }}
              >
                {copy.copy}
              </button>
              {destination === undefined ? null : (
                <a
                  className={styles.destinationButton}
                  href={destination.targetUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy.openDestination(destination.displayName)}
                </a>
              )}
            </div>
            <p className={styles.status} role="status" aria-live="polite">
              {copyStatus === "copied"
                ? copy.copied
                : copyStatus === "manual"
                  ? copy.manualCopy
                  : copy.readyToCopy}
            </p>
          </section>
        ) : null}
        {groundingRejected || formatRejected ? (
          <button
            className={styles.primaryButton}
            type="button"
            onClick={() =>
              setState((current) =>
                transitionReviewSession(current, { type: "RETURN_TO_FACTS" }),
              )
            }
          >
            {copy.changeFacts}
          </button>
        ) : null}
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
            {copy.retry}
          </button>
        ) : null}
      </SurveyScreen>
    );
  }

  if (reviewSessionQuery.isError) {
    return (
      <main>
        <h1>Review unavailable</h1>
        <p role="alert">This review could not be resumed.</p>
        <button type="button" onClick={() => void reviewSessionQuery.refetch()}>
          Try again
        </button>
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
  readonly reviewerDispositionClient?: ReviewerDispositionClient | undefined;
  readonly newIdempotencyKey?: (() => string) | undefined;
  readonly copyText?: ((text: string) => Promise<void>) | undefined;
  readonly navigate?: ((path: string) => void) | undefined;
}

export function ReviewerApplication({
  entryChallengeClient = defaultEntryChallengeClient,
  reviewSessionClient = defaultReviewSessionClient,
  generationClient = defaultGenerationClient,
  reviewerDispositionClient = defaultReviewerDispositionClient,
  newIdempotencyKey = () => globalThis.crypto.randomUUID(),
  copyText = defaultCopyText,
  navigate = defaultNavigate,
}: ReviewerApplicationProps = {}): React.JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
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
            reviewerDispositionClient={reviewerDispositionClient}
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
    </QueryClientProvider>
  );
}
