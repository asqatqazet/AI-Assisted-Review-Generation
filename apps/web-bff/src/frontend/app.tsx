import { lazy, Suspense, useEffect, useState } from "react";
import { Route, Routes, useParams } from "react-router-dom";

import {
  createHttpEntryChallengeClient,
  type EntryChallengeClient,
} from "./entry-challenge-client.js";
import { createSurveyState, transition, type SurveyState } from "./survey-machine.js";

const OperatorConsole = lazy(() => import("./console/operator-console.js"));
const defaultEntryChallengeClient = createHttpEntryChallengeClient();
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

function ReviewRoute(): React.JSX.Element {
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
}

export function ReviewerApplication({
  entryChallengeClient = defaultEntryChallengeClient,
}: ReviewerApplicationProps = {}): React.JSX.Element {
  return (
    <Routes>
      <Route
        path="/start/:entryChallengeHandle"
        element={<StartRoute entryChallengeClient={entryChallengeClient} />}
      />
      <Route path="/review/:reviewSessionHandle" element={<ReviewRoute />} />
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
