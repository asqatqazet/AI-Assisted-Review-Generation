import { lazy, Suspense, useEffect, useState } from "react";
import { Route, Routes, useParams } from "react-router-dom";

import {
  createHttpEntryChallengeClient,
  type EntryChallengeClient,
} from "./entry-challenge-client.js";
import { createSurveyState, transition, type SurveyState } from "./survey-machine.js";

const OperatorConsole = lazy(() => import("./console/operator-console.js"));
const defaultEntryChallengeClient = createHttpEntryChallengeClient();

function StartRoute({
  entryChallengeClient,
}: {
  readonly entryChallengeClient: EntryChallengeClient;
}): React.JSX.Element {
  const { entryChallengeHandle = "" } = useParams();
  const [state, setState] = useState<SurveyState>(() =>
    createSurveyState(entryChallengeHandle),
  );

  useEffect(() => {
    const abortController = new AbortController();

    void entryChallengeClient
      .read(entryChallengeHandle, abortController.signal)
      .then((projection) => {
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
