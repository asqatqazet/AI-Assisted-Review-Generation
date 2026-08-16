import { Route, Routes } from "react-router-dom";

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
    </Routes>
  );
}
