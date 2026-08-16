import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";

const OperatorConsole = lazy(() => import("./console/operator-console.js"));

function StartRoute(): React.JSX.Element {
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

export function ReviewerApplication(): React.JSX.Element {
  return (
    <Routes>
      <Route path="/start/:entryChallengeHandle" element={<StartRoute />} />
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
