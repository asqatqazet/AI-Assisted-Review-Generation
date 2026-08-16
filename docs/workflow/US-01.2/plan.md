# US-01.2 plan

## Confirmed seam

Tests call the pure public `createSurveyState` and `transition` interface in
`apps/web-bff/src/frontend/survey-machine.ts`. They observe returned UI state only. Browser components,
network adapters and persistence are callers of this seam and are not mocked here.

The state vocabulary follows `stories/EPICS.md`; prototype labels are compatibility/test labels only.
Each red-green cycle adds one permitted event or one rejected impossible transition.
