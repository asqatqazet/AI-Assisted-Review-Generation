import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import type { ReviewSessionProgressDto } from "@review/contracts/context";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Route, Routes, useParams } from "react-router-dom";

import {
  createHttpEntryChallengeClient,
  type EntryChallengeClient,
} from "./entry-challenge-client.js";
import { BffClientError } from "./bff-error.js";
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
  createHttpReviewSessionForgetClient,
  type ReviewSessionForgetClient,
} from "./review-session-forget-client.js";
import {
  createHttpReviewerDispositionClient,
  type ReviewerDispositionClient,
} from "./reviewer-disposition-client.js";
import {
  createHttpReviewerDraftRevisionClient,
  type ReviewerDraftRevisionClient,
} from "./reviewer-draft-revision-client.js";
import {
  createReviewSessionState,
  transitionReviewSession,
  type ReviewSessionState,
} from "./review-session-machine.js";
import {
  createHttpReviewProgressClient,
  type ReviewProgressClient,
} from "./review-progress-client.js";
import { getSurveyCopy } from "./features/survey/survey-copy.js";
import {
  useEntryChallenge,
  useReviewSession,
} from "./features/survey/survey-queries.js";
import { createSurveyState, transition, type SurveyState } from "./survey-machine.js";
import styles from "./app.module.css";
import {
  createHttpConsoleClient,
  type ConsoleClient,
} from "./console/console-client.js";

const OperatorConsole = lazy(() => import("./console/operator-console.js"));
const defaultEntryChallengeClient = createHttpEntryChallengeClient();
const defaultGenerationClient = createHttpGenerationClient();
const defaultReviewSessionClient = createHttpReviewSessionClient();
const defaultReviewProgressClient = createHttpReviewProgressClient();
const defaultReviewSessionForgetClient = createHttpReviewSessionForgetClient();
const defaultReviewerDispositionClient = createHttpReviewerDispositionClient();
const defaultReviewerDraftRevisionClient =
  createHttpReviewerDraftRevisionClient();
const defaultConsoleClient = createHttpConsoleClient();
const defaultNavigate = (path: string): void => globalThis.location.assign(path);
const defaultCopyText = async (text: string): Promise<void> => {
  if (globalThis.navigator.clipboard === undefined) {
    throw new Error("CLIPBOARD_UNAVAILABLE");
  }
  await globalThis.navigator.clipboard.writeText(text);
};

const renderedDraftText = (
  body: string,
  systemAnnotations: readonly { readonly text: string }[] | undefined,
): string =>
  [body, ...(systemAnnotations ?? []).map((annotation) => annotation.text)]
    .filter((part) => part.length > 0)
    .join("\n\n");
const ratings = [
  { value: 1 },
  { value: 2 },
  { value: 3 },
  { value: 4 },
  { value: 5 },
] as const;

type ResumableProgress = Omit<ReviewSessionProgressDto, "epoch">;

function resumableProgressForState(
  state: ReviewSessionState,
): ResumableProgress | undefined {
  switch (state.value) {
    case "facts":
      return {
        phase: "facts",
        selectedFactOptionIds: [...state.selectedFactOptionIds],
        customerAssertion: state.customerAssertionConfirmed
          ? state.customerAssertion
          : "",
        sourceText: "",
        selectedReviewFormatId: null,
      };
    case "paraphrase-input":
      return {
        phase: "paraphrase-input",
        selectedFactOptionIds: [],
        customerAssertion: "",
        sourceText: state.sourceText,
        selectedReviewFormatId: null,
      };
    case "format":
      return {
        phase: "format",
        selectedFactOptionIds: [...state.selectedFactOptionIds],
        customerAssertion: state.customerAssertion,
        sourceText: state.sourceText,
        selectedReviewFormatId: state.selectedReviewFormatId,
      };
    case "generating":
    case "generation-failed":
      return {
        phase: "format",
        selectedFactOptionIds: [...state.selectedFactOptionIds],
        customerAssertion: state.customerAssertion,
        sourceText: state.sourceText,
        selectedReviewFormatId: state.selectedReviewFormatId,
      };
    case "results":
      return {
        phase: "results",
        selectedFactOptionIds: [...state.selectedFactOptionIds],
        customerAssertion: state.customerAssertion,
        sourceText: state.sourceText,
        selectedReviewFormatId: state.selectedReviewFormatId,
      };
    case "review-session-loading":
      return undefined;
  }
}

function useSurveyDocument(
  locale: string | undefined,
  locationDisplayName: string | undefined,
): void {
  useEffect(() => {
    if (locale === undefined || locationDisplayName === undefined) {
      return;
    }
    const copy = getSurveyCopy(locale);
    document.documentElement.lang = locale;
    document.title = `${locationDisplayName} — ${copy.assistantLabel}`;
  }, [locale, locationDisplayName]);
}

function useJourneyFocus(screenKey: string): void {
  useEffect(() => {
    const heading = document.querySelector("main h1");
    if (!(heading instanceof HTMLElement)) {
      return;
    }
    heading.tabIndex = -1;
    heading.focus();
  }, [screenKey]);
}

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
  footer,
}: {
  readonly brand: string;
  readonly location: string;
  readonly locale: string;
  readonly busy?: boolean | undefined;
  readonly children: React.ReactNode;
  readonly footer?: React.ReactNode | undefined;
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
        {footer}
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
  copyText,
}: {
  readonly entryChallengeClient: EntryChallengeClient;
  readonly navigate: (path: string) => void;
  readonly copyText: (text: string) => Promise<void>;
}): React.JSX.Element {
  const { entryChallengeHandle = "" } = useParams();
  const [state, setState] = useState<SurveyState>(() =>
    createSurveyState(entryChallengeHandle),
  );
  const [csrfToken, setCsrfToken] = useState("");
  const [manualReview, setManualReview] = useState("");
  const [manualCopyStatus, setManualCopyStatus] = useState<
    "idle" | "copied" | "manual"
  >("idle");
  const entryChallengeQuery = useEntryChallenge(
    entryChallengeClient,
    entryChallengeHandle,
  );
  const entryContext = "context" in state ? state.context : undefined;
  useSurveyDocument(entryContext?.locale, entryContext?.locationDisplayName);
  useJourneyFocus(
    `${state.value}:${entryChallengeQuery.isError ? "error" : "ready"}`,
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
    onSuccess: (result) => {
      if ("redirectTo" in result) {
        navigate(result.redirectTo);
        return;
      }
      setState((current) =>
        transition(current, { type: "VERIFICATION_REQUIRED" }),
      );
    },
    onError: () =>
      setState((current) =>
        transition(current, { type: "START_FAILED" }),
      ),
  });
  const verifyMutation = useMutation({
    mutationKey: ["verify-entry", entryChallengeHandle],
    mutationFn: (verificationEvidence: string) => {
      if (entryChallengeClient.verify === undefined) {
        throw new Error("ENTRY_UNAVAILABLE");
      }
      return entryChallengeClient.verify(
        {
          entryChallengeHandle,
          verificationEvidence,
          csrfToken,
        },
        new AbortController().signal,
      );
    },
    onSuccess: (result) => {
      if ("redirectTo" in result) {
        navigate(result.redirectTo);
        return;
      }
      setState((current) =>
        transition(current, { type: "VERIFICATION_UNAVAILABLE" }),
      );
    },
    onError: () =>
      setState((current) =>
        transition(current, { type: "VERIFICATION_FAILED" }),
      ),
  });

  useEffect(() => {
    setState(createSurveyState(entryChallengeHandle));
    setCsrfToken("");
    setManualReview("");
    setManualCopyStatus("idle");
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
        ...(entryChallengeQuery.data.stage === undefined
          ? {}
          : { stage: entryChallengeQuery.data.stage }),
        ...(entryChallengeQuery.data.provisionalSelection === undefined
          ? {}
          : {
              provisionalSelection:
                entryChallengeQuery.data.provisionalSelection,
            }),
      }),
    );
  }, [entryChallengeQuery.data]);

  if (state.value === "verification") {
    const copy = getSurveyCopy(state.context.locale);
    return (
      <SurveyScreen
        brand={state.context.tenantDisplayName}
        location={state.context.locationDisplayName}
        locale={state.context.locale}
        busy={verifyMutation.isPending}
      >
        <p className={styles.eyebrow}>{copy.verificationEyebrow}</p>
        <h1 className={styles.title}>{copy.verificationHeading}</h1>
        <p className={styles.lead}>{copy.verificationLead}</p>
        {state.provisionalSelection === null ? null : (
          <p className={styles.selectionCount}>
            {copy.verificationSelectionSaved(
              state.provisionalSelection.rating,
              state.provisionalSelection.action,
            )}
          </p>
        )}
        <form
          className={styles.resultCard}
          onSubmit={(event) => {
            event.preventDefault();
            const evidence = state.verificationEvidence.trim();
            if (evidence.length === 0 || verifyMutation.isPending) {
              return;
            }
            verifyMutation.mutate(evidence);
          }}
        >
          <label className={styles.fieldLabel} htmlFor="verification-evidence">
            {copy.verificationCodeLabel}
          </label>
          <input
            className={styles.verificationInput}
            id="verification-evidence"
            type="text"
            autoComplete="off"
            maxLength={500}
            placeholder={copy.verificationCodePlaceholder}
            value={state.verificationEvidence}
            aria-describedby="verification-help verification-status"
            onChange={(event) =>
              setState((current) =>
                transition(current, {
                  type: "VERIFICATION_EVIDENCE_CHANGED",
                  value: event.target.value,
                }),
              )
            }
          />
          <p className={styles.pathHint} id="verification-help">
            {copy.verificationReason}
          </p>
          <button
            className={styles.primaryButton}
            type="submit"
            disabled={
              state.verificationEvidence.trim().length === 0 ||
              verifyMutation.isPending
            }
          >
            {copy.verificationContinue}
          </button>
          <button
            className={styles.textButton}
            type="button"
            disabled={verifyMutation.isPending}
            onClick={() =>
              setState((current) =>
                transition(current, { type: "VERIFICATION_UNAVAILABLE" }),
              )
            }
          >
            {copy.verificationNoCode}
          </button>
          <p
            className={styles.status}
            id="verification-status"
            role={state.submissionFailed ? "alert" : "status"}
            aria-live="polite"
          >
            {state.submissionFailed ? copy.verificationFailed : ""}
          </p>
        </form>
      </SurveyScreen>
    );
  }

  if (state.value === "verification-unavailable") {
    const copy = getSurveyCopy(state.context.locale);
    const destination = state.context.destinations[0];
    return (
      <SurveyScreen
        brand={state.context.tenantDisplayName}
        location={state.context.locationDisplayName}
        locale={state.context.locale}
      >
        <p className={styles.eyebrow}>
          {copy.verificationUnavailableEyebrow}
        </p>
        <h1 className={styles.title}>
          {copy.verificationUnavailableHeading}
        </h1>
        <p className={styles.lead}>
          {copy.verificationUnavailableBody(state.context.tenantDisplayName)}
        </p>
        <section className={styles.resultCard}>
          <label className={styles.fieldLabel} htmlFor="unaided-review-text">
            {copy.manualReviewLabel}
          </label>
          <textarea
            className={styles.reviewTextarea}
            id="unaided-review-text"
            value={manualReview}
            onChange={(event) => setManualReview(event.target.value)}
          />
          <p className={styles.characterCount}>
            {copy.characters(manualReview.length)}
          </p>
          <div className={styles.resultActions}>
            <button
              className={styles.copyButton}
              type="button"
              disabled={manualReview.trim().length === 0}
              onClick={() => {
                void copyText(manualReview)
                  .then(() => setManualCopyStatus("copied"))
                  .catch(() => setManualCopyStatus("manual"));
              }}
            >
              {copy.copy}
            </button>
            {destination === undefined ? null : (
              <a
                className={styles.destinationButton}
                href={destination.targetUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {copy.openDestination(destination.displayName)}
              </a>
            )}
          </div>
          <p className={styles.status} role="status" aria-live="polite">
            {manualCopyStatus === "copied"
              ? copy.copied
              : manualCopyStatus === "manual"
                ? copy.manualCopy
                : copy.copyFootnote}
          </p>
        </section>
        <button
          className={styles.textButton}
          type="button"
          onClick={() =>
            setState((current) =>
              transition(current, { type: "RETURN_TO_VERIFICATION" }),
            )
          }
        >
          {copy.verificationBack}
        </button>
      </SurveyScreen>
    );
  }

  if (state.value === "entry") {
    const copy = getSurveyCopy(state.context.locale);
    const availableActions = new Set(
      state.context.reviewFormats
        .flatMap((format) => format.availableCommands),
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
            <>
              <p className={styles.status} role="alert">
                {copy.assistanceUnavailable}
              </p>
              <section className={styles.resultCard}>
                <label className={styles.fieldLabel} htmlFor="unconfigured-review">
                  {copy.manualReviewLabel}
                </label>
                <textarea
                  className={styles.reviewTextarea}
                  id="unconfigured-review"
                  value={manualReview}
                  onChange={(event) => setManualReview(event.target.value)}
                />
                <p className={styles.characterCount}>
                  {copy.characters(manualReview.length)}
                </p>
                <button
                  className={styles.copyButton}
                  type="button"
                  disabled={manualReview.trim().length === 0}
                  onClick={() => {
                    void copyText(manualReview)
                      .then(() => setManualCopyStatus("copied"))
                      .catch(() => setManualCopyStatus("manual"));
                  }}
                >
                  {copy.copy}
                </button>
                <p className={styles.status} role="status" aria-live="polite">
                  {manualCopyStatus === "copied"
                    ? copy.copied
                    : manualCopyStatus === "manual"
                      ? copy.manualCopy
                      : copy.copyFootnote}
                </p>
              </section>
            </>
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
    const retryable =
      !(entryChallengeQuery.error instanceof BffClientError) ||
      entryChallengeQuery.error.retryable;
    return (
      <div className={styles.page}>
        <SurveyHeader brand="Review assistant" />
        <main className={styles.surveyMain}>
          <h1 className={styles.title}>Review link unavailable</h1>
          <p className={styles.lead} role="alert">
            This review link could not be opened. You can still write and copy
            your own review here.
          </p>
          <section className={styles.resultCard}>
            <label className={styles.fieldLabel} htmlFor="unavailable-review-text">
              Write your review yourself
            </label>
            <textarea
              className={styles.reviewTextarea}
              id="unavailable-review-text"
              value={manualReview}
              onChange={(event) => setManualReview(event.target.value)}
            />
            <p className={styles.characterCount}>
              {manualReview.length} characters
            </p>
            <div className={styles.resultActions}>
              <button
                className={styles.copyButton}
                type="button"
                disabled={manualReview.trim().length === 0}
                onClick={() => {
                  void copyText(manualReview)
                    .then(() => setManualCopyStatus("copied"))
                    .catch(() => setManualCopyStatus("manual"));
                }}
              >
                Copy
              </button>
              {retryable ? (
                <button
                  className={styles.textButton}
                  type="button"
                  onClick={() => void entryChallengeQuery.refetch()}
                >
                  Try link again
                </button>
              ) : null}
            </div>
            <p className={styles.status} role="status" aria-live="polite">
              {manualCopyStatus === "copied"
                ? "Copied"
                : manualCopyStatus === "manual"
                  ? "Select the review text and copy it manually."
                  : "Nothing is sent or posted from this page."}
            </p>
          </section>
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
  reviewProgressClient,
  reviewSessionForgetClient,
  generationClient,
  reviewerDispositionClient,
  reviewerDraftRevisionClient,
  newIdempotencyKey,
  copyText,
  navigate,
}: {
  readonly reviewSessionClient: ReviewSessionClient;
  readonly reviewProgressClient: ReviewProgressClient;
  readonly reviewSessionForgetClient: ReviewSessionForgetClient;
  readonly generationClient: GenerationClient;
  readonly reviewerDispositionClient: ReviewerDispositionClient;
  readonly reviewerDraftRevisionClient: ReviewerDraftRevisionClient;
  readonly newIdempotencyKey: () => string;
  readonly copyText: (text: string) => Promise<void>;
  readonly navigate: (path: string) => void;
}): React.JSX.Element {
  const { reviewSessionHandle = "" } = useParams();
  const [state, setState] = useState(() =>
    createReviewSessionState(reviewSessionHandle),
  );
  const [copyStatus, setCopyStatus] = useState<
    "idle" | "copied" | "manual" | "recording" | "record-failed"
  >("idle");
  const [draftText, setDraftText] = useState("");
  const [wordingInstruction, setWordingInstruction] = useState("");
  const [completedText, setCompletedText] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<{
    readonly phase: "queued" | "generating" | "validating" | "persisting";
    readonly elapsedSeconds: number;
  }>({ phase: "queued", elapsedSeconds: 0 });
  const [retrySecondsRemaining, setRetrySecondsRemaining] = useState(0);
  const generationAbortRef = useRef<AbortController | null>(null);
  const progressEpochRef = useRef<number | undefined>(undefined);
  const progressWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  const lastPersistedProgressRef = useRef<string | undefined>(undefined);
  const lastQueuedProgressRef = useRef<string | undefined>(undefined);
  const progressConflictRef = useRef(false);
  const [progressSaveStatus, setProgressSaveStatus] = useState<
    "idle" | "saving" | "saved" | "conflict" | "failed"
  >("idle");
  const [draftSaveStatus, setDraftSaveStatus] = useState<
    "idle" | "saving" | "saved" | "conflict" | "failed"
  >("idle");
  const draftRevisionRef = useRef<number | undefined>(undefined);
  const draftIdentityRef = useRef<string | undefined>(undefined);
  const lastSavedDraftTextRef = useRef<string | undefined>(undefined);
  const lastQueuedDraftTextRef = useRef<string | undefined>(undefined);
  const draftWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  const draftConflictRef = useRef(false);
  const draftAutosaveSuspendedRef = useRef(false);
  const [forgetStatus, setForgetStatus] = useState<
    "idle" | "confirming" | "forgetting" | "failed"
  >("idle");
  const reviewSessionQuery = useReviewSession(
    reviewSessionClient,
    reviewSessionHandle,
  );
  const reviewProjection = "projection" in state ? state.projection : undefined;
  useSurveyDocument(
    reviewProjection?.locale,
    reviewProjection?.locationDisplayName,
  );
  useJourneyFocus(
    `${state.value}:${reviewSessionQuery.isError ? "error" : "ready"}`,
  );

  const pushFormatHistory = useCallback((): void => {
    const url = new URL(globalThis.location.href);
    if (url.searchParams.get("step") === "format") {
      return;
    }
    url.searchParams.set("step", "format");
    globalThis.history.pushState(
      { reviewSessionHandle, step: "format" },
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [reviewSessionHandle]);

  const returnToConfirmedInput = useCallback((): void => {
    const url = new URL(globalThis.location.href);
    if (url.searchParams.get("step") === "format") {
      globalThis.history.back();
    }
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    setCompletedText(null);
    setState((current) =>
      transitionReviewSession(current, { type: "RETURN_TO_FACTS" }),
    );
  }, []);

  useEffect(() => {
    const restoreHistoryStep = (): void => {
      const step = new URL(globalThis.location.href).searchParams.get("step");
      if (step === "format") {
        setState((current) => {
          if (current.value === "facts" || current.value === "paraphrase-input") {
            return transitionReviewSession(current, {
              type: "CONTINUE_REQUESTED",
            });
          }
          return current;
        });
        return;
      }
      generationAbortRef.current?.abort();
      generationAbortRef.current = null;
      setCompletedText(null);
      setState((current) =>
        transitionReviewSession(current, { type: "RETURN_TO_FACTS" }),
      );
    };
    globalThis.addEventListener("popstate", restoreHistoryStep);
    return () => globalThis.removeEventListener("popstate", restoreHistoryStep);
  }, []);

  useEffect(() => {
    setState(createReviewSessionState(reviewSessionHandle));
    setCopyStatus("idle");
    setDraftText("");
    setWordingInstruction("");
    setCompletedText(null);
    setGenerationProgress({ phase: "queued", elapsedSeconds: 0 });
    setRetrySecondsRemaining(0);
    progressEpochRef.current = undefined;
    lastPersistedProgressRef.current = undefined;
    lastQueuedProgressRef.current = undefined;
    progressConflictRef.current = false;
    progressWriteChainRef.current = Promise.resolve();
    setProgressSaveStatus("idle");
    setDraftSaveStatus("idle");
    draftRevisionRef.current = undefined;
    draftIdentityRef.current = undefined;
    lastSavedDraftTextRef.current = undefined;
    lastQueuedDraftTextRef.current = undefined;
    draftWriteChainRef.current = Promise.resolve();
    draftConflictRef.current = false;
    draftAutosaveSuspendedRef.current = false;
    setForgetStatus("idle");
  }, [reviewSessionHandle]);

  useEffect(() => {
    if (reviewSessionQuery.data === undefined) {
      return;
    }
    const progress = reviewSessionQuery.data.progress;
    progressEpochRef.current = progress?.epoch;
    const serializedProgress =
      progress === undefined
        ? undefined
        : JSON.stringify({
            phase: progress.phase,
            selectedFactOptionIds: progress.selectedFactOptionIds,
            customerAssertion: progress.customerAssertion,
            sourceText: progress.sourceText,
            selectedReviewFormatId: progress.selectedReviewFormatId,
          });
    lastPersistedProgressRef.current = serializedProgress;
    lastQueuedProgressRef.current = serializedProgress;
    progressConflictRef.current = false;
    setProgressSaveStatus("idle");
    if (
      progress !== undefined &&
      ["results", "editing", "done"].includes(progress.phase)
    ) {
      const newestDraft = reviewSessionQuery.data.drafts?.at(-1);
      if (newestDraft !== undefined) {
        setDraftText(newestDraft.text);
        setCompletedText(
          progress.phase === "done"
            ? renderedDraftText(
                newestDraft.text,
                newestDraft.systemAnnotations,
              )
            : null,
        );
      }
    }
    setState((current) =>
      transitionReviewSession(current, {
        type: "REVIEW_SESSION_LOADED",
        projection: reviewSessionQuery.data,
      }),
    );
  }, [reviewSessionQuery.data]);

  const persistProgress = useCallback(
    (
      progress: ResumableProgress,
      options?: { readonly keepalive?: boolean | undefined },
    ): void => {
      const serialized = JSON.stringify(progress);
      if (
        progressEpochRef.current === undefined ||
        progressConflictRef.current ||
        serialized === lastPersistedProgressRef.current ||
        serialized === lastQueuedProgressRef.current
      ) {
        return;
      }
      lastQueuedProgressRef.current = serialized;
      progressWriteChainRef.current = progressWriteChainRef.current
        .catch(() => undefined)
        .then(async () => {
          const expectedEpoch = progressEpochRef.current;
          if (expectedEpoch === undefined || progressConflictRef.current) {
            return;
          }
          setProgressSaveStatus("saving");
          const result = await reviewProgressClient.save({
            reviewSessionHandle,
            expectedEpoch,
            progress,
          }, options);
          if (result.status === "saved") {
            progressEpochRef.current = result.progress.epoch;
            lastPersistedProgressRef.current = serialized;
            setProgressSaveStatus("saved");
            return;
          }
          if (result.status === "conflict") {
            progressEpochRef.current = result.progress.epoch;
            progressConflictRef.current = true;
            setProgressSaveStatus("conflict");
            return;
          }
          setProgressSaveStatus("failed");
        })
        .catch(() => {
          if (lastQueuedProgressRef.current === serialized) {
            lastQueuedProgressRef.current = lastPersistedProgressRef.current;
          }
          setProgressSaveStatus("failed");
        });
    },
    [reviewProgressClient, reviewSessionHandle],
  );

  useEffect(() => {
    const resumableProgress = resumableProgressForState(state);
    if (resumableProgress === undefined) {
      return undefined;
    }
    const progress =
      state.value === "results" && completedText !== null
        ? { ...resumableProgress, phase: "done" as const }
        : resumableProgress;
    const delay =
      state.value === "facts" || state.value === "paraphrase-input" ? 300 : 0;
    const timer = globalThis.setTimeout(() => persistProgress(progress), delay);
    return () => globalThis.clearTimeout(timer);
  }, [completedText, persistProgress, state]);

  useEffect(() => {
    const flushProgress = (): void => {
      const resumableProgress = resumableProgressForState(state);
      if (resumableProgress === undefined) {
        return;
      }
      persistProgress(
        state.value === "results" && completedText !== null
          ? { ...resumableProgress, phase: "done" }
          : resumableProgress,
        { keepalive: true },
      );
    };
    globalThis.addEventListener("pagehide", flushProgress);
    return () => globalThis.removeEventListener("pagehide", flushProgress);
  }, [completedText, persistProgress, state]);

  const activeDraft = state.value === "results" ? state.draft : undefined;
  const activeDraftIdentity =
    activeDraft === undefined
      ? undefined
      : `${activeDraft.id}:${activeDraft.generationId}`;

  useEffect(() => {
    if (activeDraft === undefined || activeDraftIdentity === undefined) {
      return;
    }
    if (draftIdentityRef.current === activeDraftIdentity) {
      return;
    }
    draftIdentityRef.current = activeDraftIdentity;
    draftRevisionRef.current = activeDraft.revision;
    lastSavedDraftTextRef.current = activeDraft.text;
    lastQueuedDraftTextRef.current = activeDraft.text;
    draftWriteChainRef.current = Promise.resolve();
    draftConflictRef.current = false;
    draftAutosaveSuspendedRef.current = false;
    setDraftSaveStatus("idle");
  }, [activeDraft, activeDraftIdentity]);

  const persistDraftRevision = useCallback(
    (
      draft: NonNullable<typeof activeDraft>,
      identity: string,
      text: string,
      options?: { readonly keepalive?: boolean | undefined },
    ): void => {
      if (
        text.trim().length === 0 ||
        identity !== draftIdentityRef.current ||
        text === lastSavedDraftTextRef.current ||
        text === lastQueuedDraftTextRef.current ||
        draftConflictRef.current ||
        draftAutosaveSuspendedRef.current
      ) {
        return;
      }
      lastQueuedDraftTextRef.current = text;
      draftWriteChainRef.current = draftWriteChainRef.current
        .catch(() => undefined)
        .then(async () => {
          const expectedRevision = draftRevisionRef.current;
          if (
            expectedRevision === undefined ||
            identity !== draftIdentityRef.current ||
            draftConflictRef.current ||
            draftAutosaveSuspendedRef.current
          ) {
            return;
          }
          setDraftSaveStatus("saving");
          const result = await reviewerDraftRevisionClient.save(
            {
              reviewSessionHandle,
              idempotencyKey: newIdempotencyKey(),
              draftId: draft.id,
              generationId: draft.generationId,
              expectedRevision,
              text,
            },
            options,
          );
          if (result.status === "conflict") {
            draftRevisionRef.current = result.revision;
            draftConflictRef.current = true;
            setDraftSaveStatus("conflict");
            return;
          }
          draftRevisionRef.current = result.revision;
          lastSavedDraftTextRef.current = text;
          setDraftSaveStatus("saved");
        })
        .catch(() => {
          if (lastQueuedDraftTextRef.current === text) {
            lastQueuedDraftTextRef.current = lastSavedDraftTextRef.current;
          }
          setDraftSaveStatus("failed");
        });
    },
    [newIdempotencyKey, reviewSessionHandle, reviewerDraftRevisionClient],
  );

  useEffect(() => {
    if (
      activeDraft === undefined ||
      activeDraftIdentity === undefined ||
      draftText.trim().length === 0 ||
      draftText === lastSavedDraftTextRef.current ||
      draftText === lastQueuedDraftTextRef.current ||
      draftConflictRef.current ||
      draftAutosaveSuspendedRef.current
    ) {
      return undefined;
    }

    const text = draftText;
    const identity = activeDraftIdentity;
    const timer = globalThis.setTimeout(() => {
      persistDraftRevision(activeDraft, identity, text);
    }, 600);
    return () => globalThis.clearTimeout(timer);
  }, [
    activeDraft,
    activeDraftIdentity,
    draftText,
    persistDraftRevision,
  ]);

  useEffect(() => {
    if (activeDraft === undefined || activeDraftIdentity === undefined) {
      return undefined;
    }
    const flushDraft = (): void =>
      persistDraftRevision(activeDraft, activeDraftIdentity, draftText, {
        keepalive: true,
      });
    globalThis.addEventListener("pagehide", flushDraft);
    return () => globalThis.removeEventListener("pagehide", flushDraft);
  }, [activeDraft, activeDraftIdentity, draftText, persistDraftRevision]);

  const sessionCopy = getSurveyCopy(reviewProjection?.locale ?? "en-GB");
  const privacyControl =
    reviewProjection === undefined ? null : (
      <section
        className={styles.reworkCard}
        aria-label={sessionCopy.privacyControls}
      >
        {forgetStatus === "idle" ? (
          <button
            className={styles.textButton}
            type="button"
            onClick={() => setForgetStatus("confirming")}
          >
            {sessionCopy.forgetReview}
          </button>
        ) : (
          <>
            <p className={styles.resultFootnote}>
              {sessionCopy.forgetConfirmation}
            </p>
            <div className={styles.resultActions}>
              <button
                className={styles.textButton}
                type="button"
                disabled={forgetStatus === "forgetting"}
                onClick={() => {
                  setForgetStatus("forgetting");
                  void reviewSessionForgetClient
                    .forget({ reviewSessionHandle })
                    .then(() => navigate("/"))
                    .catch(() => setForgetStatus("failed"));
                }}
              >
                {sessionCopy.confirmForget}
              </button>
              <button
                className={styles.textButton}
                type="button"
                disabled={forgetStatus === "forgetting"}
                onClick={() => setForgetStatus("idle")}
              >
                {sessionCopy.cancelForget}
              </button>
            </div>
            {forgetStatus === "forgetting" ? (
              <p className={styles.status} role="status">
                {sessionCopy.forgettingReview}
              </p>
            ) : null}
            {forgetStatus === "failed" ? (
              <p className={styles.status} role="alert">
                {sessionCopy.forgetFailed}
              </p>
            ) : null}
          </>
        )}
      </section>
    );

  const retryAfterSeconds =
    state.value === "generation-failed" ? state.retryAfterSeconds : undefined;
  useEffect(() => {
    const initial = retryAfterSeconds ?? 0;
    setRetrySecondsRemaining(initial);
    if (initial === 0) {
      return undefined;
    }
    const interval = globalThis.setInterval(() => {
      setRetrySecondsRemaining((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => globalThis.clearInterval(interval);
  }, [retryAfterSeconds]);

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
            ...(state.command !== undefined
              ? { command: state.command }
              : state.projection.action === "paraphrase"
                ? {
                    sourceText: state.sourceText,
                    reviewFormatId: state.selectedReviewFormatId,
                  }
                : {
                    factOptionIds: state.selectedFactOptionIds,
                    reviewFormatId: state.selectedReviewFormatId,
                    ...(state.customerAssertion.trim().length === 0
                      ? {}
                      : {
                          customerAssertion: state.customerAssertion.trim(),
                        }),
                  }),
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
            setWordingInstruction("");
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
                ...(event.retryAfterSeconds === undefined
                  ? {}
                  : { retryAfterSeconds: event.retryAfterSeconds }),
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
              ...(error instanceof GenerationTransportError &&
              error.retryAfterSeconds !== undefined
                ? { retryAfterSeconds: error.retryAfterSeconds }
                : {}),
              resumeExisting: true,
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

  if (state.value === "paraphrase-input") {
    const copy = getSurveyCopy(state.projection.locale);
    const canContinue = state.sourceText.trim().length >= 20;
    return (
      <SurveyScreen
        brand={state.projection.tenantDisplayName}
        location={state.projection.locationDisplayName}
        locale={state.projection.locale}
        footer={privacyControl}
      >
        <p className={styles.eyebrow}>{copy.sourceTextEyebrow}</p>
        <h1 className={styles.title}>{copy.sourceTextHeading}</h1>
        <p className={styles.lead}>{copy.sourceTextLead}</p>
        {progressSaveStatus === "conflict" || progressSaveStatus === "failed" ? (
          <p className={styles.status} role="alert">
            {progressSaveStatus === "conflict"
              ? copy.progressSaveConflict
              : copy.progressSaveFailed}
          </p>
        ) : null}
        <form className={styles.reviewForm}>
          <label className={styles.fieldLabel} htmlFor="source-review-text">
            {copy.sourceTextLabel}
          </label>
          <textarea
            className={styles.reviewTextarea}
            id="source-review-text"
            aria-describedby="source-review-count source-review-help"
            maxLength={10_000}
            value={state.sourceText}
            onChange={(event) =>
              setState((current) =>
                transitionReviewSession(current, {
                  type: "SOURCE_TEXT_CHANGED",
                  value: event.target.value,
                }),
              )
            }
          />
          <p className={styles.characterCount} id="source-review-count">
            {copy.charactersAgainstLimit(state.sourceText.length, 10_000)}
          </p>
          <p className={styles.pathHint} id="source-review-help">
            {copy.sourceTextHelp}
          </p>
          <button
            className={styles.primaryButton}
            type="button"
            disabled={!canContinue}
            onClick={() => {
              pushFormatHistory();
              setState((current) =>
                transitionReviewSession(current, {
                  type: "CONTINUE_REQUESTED",
                }),
              );
            }}
          >
            {copy.chooseFormat}
          </button>
          {canContinue ? null : (
            <p className={styles.pathHint}>{copy.sourceTextMinimum}</p>
          )}
        </form>
      </SurveyScreen>
    );
  }

  if (state.value === "facts") {
    const copy = getSurveyCopy(state.projection.locale);
    const hasMinimumAssertions =
      (state.customerAssertionConfirmed &&
        state.customerAssertion.trim().length > 0) ||
      state.selectedFactOptionIds.length >=
        state.projection.requirements.minimumFactSelections;
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
        footer={privacyControl}
      >
        <p className={styles.eyebrow}>{copy.factsEyebrow}</p>
        <h1 className={styles.title}>{copy.factsHeading}</h1>
        <p className={styles.lead}>{copy.factsLead}</p>
        {progressSaveStatus === "conflict" || progressSaveStatus === "failed" ? (
          <p className={styles.status} role="alert">
            {progressSaveStatus === "conflict"
              ? copy.progressSaveConflict
              : copy.progressSaveFailed}
          </p>
        ) : null}
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
              aria-describedby="customer-assertion-count customer-assertion-help"
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
            <p className={styles.characterCount} id="customer-assertion-count">
              {copy.charactersAgainstLimit(
                state.customerAssertion.length,
                state.projection.requirements.maximumCustomerAssertionChars,
              )}
            </p>
            <p className={styles.pathHint} id="customer-assertion-help">
              {copy.optionalFactHelp(
                state.projection.requirements.maximumCustomerAssertionChars,
              )}
            </p>
            <button
              className={styles.textButton}
              type="button"
              disabled={
                state.customerAssertion.trim().length === 0 ||
                state.customerAssertionConfirmed
              }
              onClick={() =>
                setState((current) =>
                  transitionReviewSession(current, {
                    type: "CUSTOMER_ASSERTION_CONFIRMED",
                  }),
                )
              }
            >
              {copy.confirmAssertion}
            </button>
            {state.customerAssertionConfirmed ? (
              <p className={styles.status} role="status">
                {copy.assertionConfirmed}
              </p>
            ) : null}
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
            disabled={!hasMinimumAssertions}
            onClick={() => {
              pushFormatHistory();
              setState((current) =>
                transitionReviewSession(current, {
                  type: "CONTINUE_REQUESTED",
                }),
              );
            }}
          >
            {copy.chooseFormat}
          </button>
          {hasMinimumAssertions ? null : (
            <p className={styles.pathHint}>
              {copy.minimumFacts(
                state.projection.requirements.minimumFactSelections,
              )}
            </p>
          )}
        </form>
      </SurveyScreen>
    );
  }

  if (state.value === "format") {
    const copy = getSurveyCopy(state.projection.locale);
    const requiredCommand =
      state.sourceGenerationId === undefined
        ? state.projection.action
        : "reformat";
    const compatibleFormats = state.projection.reviewFormats.filter((format) =>
      format.availableCommands.includes(requiredCommand),
    );
    if (compatibleFormats.length === 0) {
      return (
        <SurveyScreen
          brand={state.projection.tenantDisplayName}
          location={state.projection.locationDisplayName}
          locale={state.projection.locale}
          footer={privacyControl}
        >
          <h1 className={styles.title}>{copy.notConfiguredHeading}</h1>
          <p className={styles.lead} role="alert">
            {copy.notConfiguredBody}
          </p>
          <section className={styles.resultCard}>
            <label className={styles.fieldLabel} htmlFor="unconfigured-format-review">
              {copy.manualReviewLabel}
            </label>
            <textarea
              className={styles.reviewTextarea}
              id="unconfigured-format-review"
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
            />
            <p className={styles.characterCount}>
              {copy.characters(draftText.length)}
            </p>
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
            <p className={styles.status} role="status" aria-live="polite">
              {copyStatus === "copied"
                ? copy.copied
                : copyStatus === "manual"
                  ? copy.manualCopy
                  : copy.readyToCopy}
            </p>
          </section>
          <button
            className={styles.textButton}
            type="button"
            onClick={returnToConfirmedInput}
          >
            {copy.back}
          </button>
        </SurveyScreen>
      );
    }
    return (
      <SurveyScreen
        brand={state.projection.tenantDisplayName}
        location={state.projection.locationDisplayName}
        locale={state.projection.locale}
        footer={privacyControl}
      >
        <p className={styles.eyebrow}>{copy.factsEyebrow}</p>
        <h1 className={styles.title}>{copy.formatHeading}</h1>
        <p className={styles.lead}>{copy.formatLead}</p>
        {progressSaveStatus === "conflict" || progressSaveStatus === "failed" ? (
          <p className={styles.status} role="alert">
            {progressSaveStatus === "conflict"
              ? copy.progressSaveConflict
              : copy.progressSaveFailed}
          </p>
        ) : null}
        <form className={styles.reviewForm}>
          <fieldset className={styles.choiceFieldset}>
            <legend className={styles.sectionTitle}>
              {copy.formatLegend}
            </legend>
            <div className={styles.choiceList}>
            {compatibleFormats.map((format) => {
              const descriptionId = `review-format-${format.id}-description`;
              const constraintId = `review-format-${format.id}-constraint`;
              const sampleId = `review-format-${format.id}-sample`;
              return (
              <label className={styles.formatCard} key={format.id}>
                <input
                  className={styles.visuallyHidden}
                  type="radio"
                  name="reviewFormatId"
                  value={format.id}
                  aria-label={format.displayName}
                  aria-describedby={`${descriptionId} ${constraintId} ${sampleId}`}
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
                  <span className={styles.formatDescription} id={descriptionId}>
                    {format.description}
                  </span>
                  <span className={styles.formatMeta}>{copy.formatMeta}</span>
                  <span className={styles.formatConstraint} id={constraintId}>
                    {copy.formatConstraints(
                      format.constraints.minChars,
                      format.constraints.maxChars,
                    )}
                  </span>
                  <span className={styles.formatSample} id={sampleId}>
                    {format.sample}
                  </span>
                </span>
              </label>
              );
            })}
            </div>
          </fieldset>
          <button
            className={styles.textButton}
            type="button"
            onClick={returnToConfirmedInput}
          >
            {state.projection.action === "paraphrase"
              ? copy.backToSourceText
              : copy.back}
          </button>
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
        footer={privacyControl}
      >
        <h1 className={styles.title}>{copy.generatingHeading}</h1>
        <section className={styles.progressCard}>
          <p className={styles.progressTitle}>{copy.checkingDraft}</p>
          <p
            className={styles.progressMeta}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {copy.progress(
              generationProgress.phase,
              generationProgress.elapsedSeconds,
            )}
          </p>
          <div className={styles.progressTrack} aria-hidden="true">
            <span className={styles.progressBar} />
          </div>
          <p className={styles.status}>
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
                  resumeExisting: true,
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
    const condenseTarget =
      selectedFormat === undefined
        ? 0
        : Math.max(
            selectedFormat.constraints.minChars,
            Math.floor(state.draft.text.length * 0.75),
          );
    const expandTarget =
      selectedFormat === undefined
        ? 0
        : Math.min(
            selectedFormat.constraints.maxChars,
            Math.max(
              selectedFormat.constraints.minChars,
              state.draft.text.length + Math.max(20, Math.ceil(state.draft.text.length * 0.25)),
            ),
          );
    const canCondense =
      selectedFormat?.availableCommands.includes("condense") === true &&
      condenseTarget < state.draft.text.length;
    const canExpand =
      selectedFormat?.availableCommands.includes("expand") === true &&
      expandTarget > state.draft.text.length;
    const canReviseWording =
      selectedFormat?.availableCommands.includes("revise-wording") === true;
    const canStartAnotherFormat = state.projection.reviewFormats.some(
      (format) =>
        format.id !== state.selectedReviewFormatId &&
        format.availableCommands.includes("reformat"),
    );
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
          footer={privacyControl}
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
            <p className={styles.status} role="status" aria-live="polite">
              {copyStatus === "manual"
                ? copy.manualCopy
                : copyStatus === "copied"
                  ? copy.copied
                  : ""}
            </p>
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
            {canStartAnotherFormat ? (
              <button
                className={styles.textButton}
                type="button"
                onClick={() => {
                  setCompletedText(null);
                  pushFormatHistory();
                  setState((current) =>
                    transitionReviewSession(current, {
                      type: "RETURN_TO_FORMAT",
                    }),
                  );
                }}
              >
                {copy.anotherFormat}
              </button>
            ) : null}
          </section>
        </SurveyScreen>
      );
    }

    return (
      <SurveyScreen
        brand={state.projection.tenantDisplayName}
        location={state.projection.locationDisplayName}
        locale={state.projection.locale}
        footer={privacyControl}
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
            aria-describedby="draft-save-status"
            readOnly={draftSaveStatus === "conflict"}
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
          />
          {(state.draft.systemAnnotations ?? []).length === 0 ? null : (
            <aside className={styles.systemAnnotations} aria-label="System note">
              {(state.draft.systemAnnotations ?? []).map((annotation) => (
                <p
                  className={styles.systemAnnotation}
                  key={`${annotation.kind}:${annotation.policyVersionId}`}
                >
                  {annotation.text}
                </p>
              ))}
            </aside>
          )}
          <p className={styles.characterCount}>
            {selectedFormat === undefined
              ? copy.characters(draftText.length)
              : copy.charactersAgainstLimit(
                  draftText.length,
                  selectedFormat.constraints.maxChars,
                )}
          </p>
          {dirty ? (
            <p className={styles.editedState}>
              {copy.editedByYou}
            </p>
          ) : null}
          <p
            className={styles.status}
            id="draft-save-status"
            role={
              draftSaveStatus === "conflict" || draftSaveStatus === "failed"
                ? "alert"
                : "status"
            }
            aria-live="polite"
          >
            {draftSaveStatus === "saving"
              ? copy.draftSaving
              : draftSaveStatus === "saved"
                ? copy.draftSaved
                : draftSaveStatus === "conflict"
                  ? copy.draftSaveConflict
                  : draftSaveStatus === "failed"
                    ? copy.draftSaveFailed
                    : ""}
          </p>
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
            <ul className={styles.provenanceList}>
              {state.selectedFactOptionIds.map((factOptionId) => {
                const factOption = state.projection.factOptions.find(
                  (candidate) => candidate.id === factOptionId,
                );
                return factOption === undefined ? null : (
                  <li key={factOption.id}>{factOption.label}</li>
                );
              })}
              {state.customerAssertion.trim().length === 0 ? null : (
                <li>{state.customerAssertion}</li>
              )}
              {state.sourceText.trim().length === 0 ? null : (
                <li>{state.sourceText}</li>
              )}
            </ul>
          </details>
          <div className={styles.resultActions}>
            <button
              className={styles.copyButton}
              type="button"
              disabled={
                draftText.trim().length === 0 || copyStatus === "recording"
              }
              onClick={() => {
                const finalText = draftText;
                const copyableText = renderedDraftText(
                  finalText,
                  state.draft.systemAnnotations,
                );
                const idempotencyKey = newIdempotencyKey();
                draftAutosaveSuspendedRef.current = true;
                void (async () => {
                  try {
                    await copyText(copyableText);
                  } catch {
                    draftAutosaveSuspendedRef.current = false;
                    setCopyStatus("manual");
                    return;
                  }
                  setCopyStatus("recording");
                  try {
                    await draftWriteChainRef.current;
                    if (draftConflictRef.current) {
                      setCopyStatus("record-failed");
                      return;
                    }
                    await reviewerDispositionClient.record({
                      reviewSessionHandle: state.reviewSessionHandle,
                      idempotencyKey,
                      draftId: state.draft.id,
                      generationId: state.draft.generationId,
                      finalText,
                    });
                  } catch {
                    setCopyStatus("record-failed");
                    return;
                  }
                  setCopyStatus("copied");
                  setCompletedText(copyableText);
                })();
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
                : copyStatus === "recording"
                  ? copy.dispositionRecording
                  : copyStatus === "record-failed"
                    ? copy.dispositionFailed
                    : copy.readyToCopy}
          </p>
        </section>

        {/* A reviewer who dislikes the Draft can ask again without losing the
            points they already confirmed. */}
        <section className={styles.reworkCard} aria-label={copy.reworkLabel}>
          <p className={styles.eyebrow}>{copy.reworkLabel}</p>
          <div className={styles.resultActions}>
            {canCondense ? (
              <button
                className={styles.textButton}
                type="button"
                onClick={() =>
                  setState((current) =>
                    transitionReviewSession(current, {
                      type: "TRANSFORMATION_REQUESTED",
                      idempotencyKey: newIdempotencyKey(),
                      command: {
                        action: "condense",
                        sourceGenerationId: state.draft.generationId,
                        targetMaxChars: condenseTarget,
                      },
                    }),
                  )
                }
              >
                {copy.makeShorter}
              </button>
            ) : null}
            {canExpand ? (
              <button
                className={styles.textButton}
                type="button"
                onClick={() =>
                  setState((current) =>
                    transitionReviewSession(current, {
                      type: "TRANSFORMATION_REQUESTED",
                      idempotencyKey: newIdempotencyKey(),
                      command: {
                        action: "expand",
                        sourceGenerationId: state.draft.generationId,
                        targetMinChars: expandTarget,
                      },
                    }),
                  )
                }
              >
                {copy.makeLonger}
              </button>
            ) : null}
            {canStartAnotherFormat ? (
              <button
                className={styles.textButton}
                type="button"
                onClick={() => {
                  pushFormatHistory();
                  setState((current) =>
                    transitionReviewSession(current, {
                      type: "RETURN_TO_FORMAT",
                    }),
                  );
                }}
              >
                {copy.tryAnotherFormat}
              </button>
            ) : null}
            <button
              className={styles.textButton}
              type="button"
              onClick={returnToConfirmedInput}
            >
              {copy.changeWhatYouSaid}
            </button>
          </div>
          {canReviseWording ? (
            <div className={styles.factAssertionField}>
              <label className={styles.fieldLabel} htmlFor="wording-instruction">
                {copy.wordingInstructionLabel}
              </label>
              <input
                className={styles.reviewTextarea}
                id="wording-instruction"
                type="text"
                maxLength={500}
                aria-describedby="wording-instruction-help"
                value={wordingInstruction}
                onChange={(event) => setWordingInstruction(event.target.value)}
              />
              <p className={styles.pathHint} id="wording-instruction-help">
                {copy.wordingInstructionHelp}
              </p>
              <button
                className={styles.textButton}
                type="button"
                disabled={wordingInstruction.trim().length === 0}
                onClick={() =>
                  setState((current) =>
                    transitionReviewSession(current, {
                      type: "TRANSFORMATION_REQUESTED",
                      idempotencyKey: newIdempotencyKey(),
                      command: {
                        action: "revise-wording",
                        sourceGenerationId: state.draft.generationId,
                        presentationInstruction: wordingInstruction.trim(),
                      },
                    }),
                  )
                }
              >
                {copy.applyWordingChange}
              </button>
            </div>
          ) : null}
          <p className={styles.resultFootnote}>{copy.reworkNote}</p>
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
        footer={privacyControl}
      >
        <h1 className={styles.title}>{heading}</h1>
        <p className={styles.lead} role="alert">{body}</p>
        {rateLimited && retrySecondsRemaining > 0 ? (
          <p className={styles.status} role="status" aria-live="polite">
            {copy.retryAfter(retrySecondsRemaining)}
          </p>
        ) : null}
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
        {groundingRejected ? (
          <button
            className={styles.primaryButton}
            type="button"
            onClick={returnToConfirmedInput}
          >
            {copy.changeFacts}
          </button>
        ) : null}
        {formatRejected ? (
          <button
            className={styles.primaryButton}
            type="button"
            onClick={() => {
              pushFormatHistory();
              setState((current) =>
                transitionReviewSession(current, {
                  type: "RETURN_TO_FORMAT",
                }),
              );
            }}
          >
            {copy.changeFormat}
          </button>
        ) : null}
        {state.retryable ? (
          <button
            className={styles.primaryButton}
            type="button"
            disabled={rateLimited && retrySecondsRemaining > 0}
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
    const copy = getSurveyCopy("en-GB");
    const retryable =
      !(reviewSessionQuery.error instanceof BffClientError) ||
      reviewSessionQuery.error.retryable;
    return (
      <div className={styles.page}>
        <SurveyHeader brand="Review assistant" />
        <main className={styles.surveyMain}>
          <h1 className={styles.title}>Review unavailable</h1>
          <p className={styles.lead} role="alert">
            This review could not be resumed. You can still write and copy your
            own review here.
          </p>
          <section className={styles.resultCard}>
            <label className={styles.fieldLabel} htmlFor="resume-manual-review">
              {copy.manualReviewLabel}
            </label>
            <textarea
              className={styles.reviewTextarea}
              id="resume-manual-review"
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
              {retryable ? (
                <button
                  className={styles.textButton}
                  type="button"
                  onClick={() => void reviewSessionQuery.refetch()}
                >
                  {copy.retry}
                </button>
              ) : null}
            </div>
            <p className={styles.status} role="status" aria-live="polite">
              {copyStatus === "copied"
                ? copy.copied
                : copyStatus === "manual"
                  ? copy.manualCopy
                  : copy.readyToCopy}
            </p>
          </section>
        </main>
      </div>
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
  readonly reviewProgressClient?: ReviewProgressClient | undefined;
  readonly reviewSessionForgetClient?: ReviewSessionForgetClient | undefined;
  readonly generationClient?: GenerationClient | undefined;
  readonly reviewerDispositionClient?: ReviewerDispositionClient | undefined;
  readonly reviewerDraftRevisionClient?:
    | ReviewerDraftRevisionClient
    | undefined;
  readonly newIdempotencyKey?: (() => string) | undefined;
  readonly copyText?: ((text: string) => Promise<void>) | undefined;
  readonly navigate?: ((path: string) => void) | undefined;
  readonly consoleClient?: ConsoleClient | undefined;
}

export function ReviewerApplication({
  entryChallengeClient = defaultEntryChallengeClient,
  reviewSessionClient = defaultReviewSessionClient,
  reviewProgressClient = defaultReviewProgressClient,
  reviewSessionForgetClient = defaultReviewSessionForgetClient,
  generationClient = defaultGenerationClient,
  reviewerDispositionClient = defaultReviewerDispositionClient,
  reviewerDraftRevisionClient = defaultReviewerDraftRevisionClient,
  newIdempotencyKey = () => globalThis.crypto.randomUUID(),
  copyText = defaultCopyText,
  navigate = defaultNavigate,
  consoleClient = defaultConsoleClient,
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
            copyText={copyText}
          />
        }
      />
      <Route
        path="/review/:reviewSessionHandle"
        element={
          <ReviewRoute
            reviewSessionClient={reviewSessionClient}
            reviewProgressClient={reviewProgressClient}
            reviewSessionForgetClient={reviewSessionForgetClient}
            generationClient={generationClient}
            reviewerDispositionClient={reviewerDispositionClient}
            reviewerDraftRevisionClient={reviewerDraftRevisionClient}
            newIdempotencyKey={newIdempotencyKey}
            copyText={copyText}
            navigate={navigate}
          />
        }
      />
      <Route
        path="/console/*"
        element={
          <Suspense fallback={<p role="status">Loading operator console…</p>}>
            <OperatorConsole client={consoleClient} />
          </Suspense>
        }
      />
      </Routes>
    </QueryClientProvider>
  );
}
