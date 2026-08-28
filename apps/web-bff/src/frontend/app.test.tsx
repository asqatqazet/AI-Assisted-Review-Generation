/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import type {
  EntryChallengeProjectionDto,
  ReviewSessionProjectionDto,
} from "@review/contracts/context";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { ReviewerApplication } from "./app.js";
import { BffClientError } from "./bff-error.js";
import { GenerationTransportError } from "./generation-client.js";
import {
  createFakeConsoleClient,
  emptyOverview,
  testBootstrap,
} from "./console/console-client.test-support.js";

afterEach(() => {
  cleanup();
  globalThis.history.replaceState(null, "", "/");
});

const requirements = {
  minimumFactSelections: 1,
  maximumReviewFormatsPerGeneration: 1,
  maximumCustomerAssertionChars: 500,
} as const;

const entryReviewFormats: EntryChallengeProjectionDto["context"]["reviewFormats"] = [
  {
    id: "format-concise-v1",
    displayName: "Concise blurb",
    description: "One concise paragraph.",
    sample: "The team was attentive.",
    targetPlatform: "google",
    constraints: { minChars: 20, maxChars: 420 },
    availableCommands: ["generate", "paraphrase"],
  },
];

const destinations: EntryChallengeProjectionDto["context"]["destinations"] = [
  {
    targetPlatform: "google",
    displayName: "Google Maps",
    targetUrl: "https://example.test/review",
  },
];

const resumableResult = (): ReviewSessionProjectionDto => ({
  status: "ready",
  reviewSessionHandle: "review-session-demo",
  tenantDisplayName: "Apex Dental",
  locationDisplayName: "Central Clinic",
  locale: "en-GB",
  rating: 4,
  action: "generate",
  requirements,
  factOptions: [
    {
      id: "fact-attentive",
      label: "The team was attentive",
      categoryLabel: "Service",
      polarity: "positive",
    },
  ],
  reviewFormats: [
    { ...entryReviewFormats[0]!, availableCommands: ["generate"] },
  ],
  destinations,
  progress: {
    epoch: 3,
    phase: "results",
    selectedFactOptionIds: ["fact-attentive"],
    customerAssertion: "",
    sourceText: "",
    selectedReviewFormatId: "format-concise-v1",
  },
  drafts: [
    {
      id: "draft-a",
      generationId: "generation-a",
      revision: 1,
      text: "The team was attentive.",
      systemAnnotations: [],
    },
  ],
});

describe("reviewer application routes", () => {
  it("offers a fresh unaided copy path without revealing why an Entry is unavailable", async () => {
    const user = userEvent.setup();
    const copied: string[] = [];
    render(
      <MemoryRouter initialEntries={["/start/unavailable-entry"]}>
        <ReviewerApplication
          entryChallengeClient={{
            read: async () => {
              throw new Error("ENTRY_UNAVAILABLE");
            },
            start: async () => {
              throw new Error("must not start");
            },
            verify: async () => {
              throw new Error("must not verify");
            },
          }}
          copyText={async (text) => {
            copied.push(text);
          }}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Review link unavailable" }),
    ).toBeVisible();
    expect(screen.getByText(/could not be opened/i)).toBeVisible();
    const manual = screen.getByRole("textbox", {
      name: "Write your review yourself",
    });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    await user.type(manual, "My own review.");
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(copied).toEqual(["My own review."]);
  });

  it("does not offer a meaningless retry for a permanently unavailable Entry", async () => {
    render(
      <MemoryRouter initialEntries={["/start/unavailable-entry"]}>
        <ReviewerApplication
          entryChallengeClient={{
            read: async () => {
              throw new BffClientError({
                code: "ENTRY_UNAVAILABLE",
                message: "This review link is unavailable.",
                retryable: false,
                requestId: "request-a",
              });
            },
            start: async () => {
              throw new Error("must not start");
            },
            verify: async () => {
              throw new Error("must not verify");
            },
          }}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Review link unavailable" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Try link again" }))
      .not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Write your review yourself" }),
    ).toBeVisible();
  });

  it("shows an accessible loading projection while a clean Start route is prepared", () => {
    render(
      <MemoryRouter initialEntries={["/start/challenge-demo"]}>
        <ReviewerApplication />
      </MemoryRouter>,
    );

    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  });

  it("shows an accessible loading projection while a Review Session is resumed", () => {
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication />
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Resuming your review");
  });

  it("keeps a local writing path without retrying a permanently unavailable Review Session", async () => {
    const user = userEvent.setup();
    const copied: string[] = [];
    render(
      <MemoryRouter initialEntries={["/review/unavailable-review"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => {
              throw new BffClientError({
                code: "REVIEW_SESSION_UNAVAILABLE",
                message: "This review is unavailable.",
                retryable: false,
                requestId: "request-b",
              });
            },
          }}
          copyText={async (text) => {
            copied.push(text);
          }}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Review unavailable" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Try again" }))
      .not.toBeInTheDocument();
    const manual = screen.getByRole("textbox", {
      name: "Write your review yourself",
    });
    await user.type(manual, "My own review.");
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(copied).toEqual(["My own review."]);
  });

  it("loads the Operator Console only for a Console route", async () => {
    render(
      <MemoryRouter initialEntries={["/console"]}>
        <ReviewerApplication
          consoleClient={createFakeConsoleClient({
            views: { bootstrap: testBootstrap, overview: emptyOverview },
          })}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Overview" }),
    ).toBeVisible();
    expect(screen.getByText("owner@example.com")).toBeVisible();
    expect(screen.getByText("Speicher Neun")).toBeVisible();
  });

  it("renders the prepared business and rating question on the Start route", async () => {
    render(
      <MemoryRouter initialEntries={["/start/entry-challenge-demo"]}>
        <ReviewerApplication
          entryChallengeClient={{
            start: async () => ({ redirectTo: "/review/review-session-demo" }),
            verify: async () => ({ status: "verification-unavailable" }),
            read: async () => ({
              status: "ready",
              entryChallengeHandle: "entry-challenge-demo",
              csrfToken: "csrf-token-with-at-least-thirty-two-characters",
              context: {
                tenantDisplayName: "Apex Dental",
                locationDisplayName: "Central Clinic",
                locale: "en-GB",
                entryMode: "invite",
                ratingRequired: true,
                requirements,
                factOptions: [],
                reviewFormats: entryReviewFormats,
                destinations,
              },
            }),
          }}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Write your review of Apex Dental",
      }),
    ).toBeVisible();
  });

  it("applies the prepared locale and Location to the browser document", async () => {
    render(
      <MemoryRouter initialEntries={["/start/entry-challenge-demo"]}>
        <ReviewerApplication
          entryChallengeClient={{
            start: async () => ({ redirectTo: "/review/review-session-demo" }),
            verify: async () => ({ status: "verification-unavailable" }),
            read: async () => ({
              status: "ready",
              entryChallengeHandle: "entry-challenge-demo",
              csrfToken: "csrf-token-with-at-least-thirty-two-characters",
              context: {
                tenantDisplayName: "Speicher Neun",
                locationDisplayName: "Speicher Neun · HafenCity",
                locale: "de-DE",
                entryMode: "open-qr",
                ratingRequired: true,
                requirements,
                factOptions: [],
                reviewFormats: entryReviewFormats,
                destinations,
              },
            }),
          }}
        />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", {
      name: "Bewerten Sie Ihren Besuch bei Speicher Neun",
    });
    expect(document.documentElement).toHaveAttribute("lang", "de-DE");
    expect(document.title).toBe(
      "Speicher Neun · HafenCity — Bewertungsassistent",
    );
  });

  it("lets the reviewer select one clearly named rating", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/start/entry-challenge-demo"]}>
        <ReviewerApplication
          entryChallengeClient={{
            start: async () => ({ redirectTo: "/review/review-session-demo" }),
            verify: async () => ({ status: "verification-unavailable" }),
            read: async () => ({
              status: "ready",
              entryChallengeHandle: "entry-challenge-demo",
              csrfToken: "csrf-token-with-at-least-thirty-two-characters",
              context: {
                tenantDisplayName: "Apex Dental",
                locationDisplayName: "Central Clinic",
                locale: "en-GB",
                entryMode: "invite",
                ratingRequired: true,
                requirements,
                factOptions: [],
                reviewFormats: entryReviewFormats,
                destinations,
              },
            }),
          }}
        />
      </MemoryRouter>,
    );

    const rating = await screen.findByRole("button", { name: "4, Good" });
    await user.click(rating);

    expect(rating).toHaveAttribute("aria-pressed", "true");
  });

  it("offers drafting paths only after the reviewer chooses a rating", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/start/entry-challenge-demo"]}>
        <ReviewerApplication
          entryChallengeClient={{
            start: async () => ({ redirectTo: "/review/review-session-demo" }),
            verify: async () => ({ status: "verification-unavailable" }),
            read: async () => ({
              status: "ready",
              entryChallengeHandle: "entry-challenge-demo",
              csrfToken: "csrf-token-with-at-least-thirty-two-characters",
              context: {
                tenantDisplayName: "Apex Dental",
                locationDisplayName: "Central Clinic",
                locale: "en-GB",
                entryMode: "invite",
                ratingRequired: true,
                requirements,
                factOptions: [],
                reviewFormats: entryReviewFormats,
                destinations,
              },
            }),
          }}
        />
      </MemoryRouter>,
    );

    const generate = await screen.findByRole("button", {
      name: "Pick what to mention",
    });
    expect(generate).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "4, Good" }));

    expect(generate).toBeEnabled();
  });

  it("renders only Actions authorized by the backend projection", async () => {
    render(
      <MemoryRouter initialEntries={["/start/entry-challenge-demo"]}>
        <ReviewerApplication
          entryChallengeClient={{
            start: async () => ({ redirectTo: "/review/review-session-demo" }),
            verify: async () => ({ status: "verification-unavailable" }),
            read: async () => ({
              status: "ready",
              entryChallengeHandle: "entry-challenge-demo",
              csrfToken: "csrf-token-with-at-least-thirty-two-characters",
              context: {
                tenantDisplayName: "Speicher Neun",
                locationDisplayName: "Speicher Neun · HafenCity",
                locale: "de-DE",
                entryMode: "open-qr",
                ratingRequired: true,
                requirements,
                factOptions: [],
                reviewFormats: [
                  {
                    ...entryReviewFormats[0]!,
                    displayName: "Kurzer Text",
                    availableCommands: ["generate"],
                  },
                ],
                destinations,
              },
            }),
          }}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("button", {
        name: "Auswählen, was erwähnt wird",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: "Meine Formulierung verbessern",
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps an unaided copy path when no assisted Action is configured", async () => {
    const user = userEvent.setup();
    const copied: string[] = [];
    render(
      <MemoryRouter initialEntries={["/start/entry-challenge-demo"]}>
        <ReviewerApplication
          entryChallengeClient={{
            start: async () => {
              throw new Error("must not start");
            },
            verify: async () => ({ status: "verification-unavailable" }),
            read: async () => ({
              status: "ready",
              entryChallengeHandle: "entry-challenge-demo",
              csrfToken: "csrf-token-with-at-least-thirty-two-characters",
              context: {
                tenantDisplayName: "Apex Dental",
                locationDisplayName: "Central Clinic",
                locale: "en-GB",
                entryMode: "open-qr",
                ratingRequired: true,
                requirements,
                factOptions: [],
                reviewFormats: [],
                destinations: [],
              },
            }),
          }}
          copyText={async (text) => {
            copied.push(text);
          }}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(
        "Review assistance is not configured for this location right now.",
      ),
    ).toBeVisible();
    const manual = screen.getByRole("textbox", {
      name: "Write your review yourself",
    });
    await user.type(manual, "My own review still works.");
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(copied).toEqual(["My own review still works."]);
  });

  it("keeps an unaided copy path when the admitted Action has no compatible Format", async () => {
    const user = userEvent.setup();
    const copied: string[] = [];
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              ...resumableResult(),
              progress: {
                epoch: 2,
                phase: "format",
                selectedFactOptionIds: ["fact-attentive"],
                customerAssertion: "",
                sourceText: "",
                selectedReviewFormatId: null,
              },
              drafts: [],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  availableCommands: ["paraphrase"],
                },
              ],
            }),
          }}
          copyText={async (text) => {
            copied.push(text);
          }}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Writing assistance is not configured",
      }),
    ).toBeVisible();
    const manual = screen.getByRole("textbox", {
      name: "Write your review yourself",
    });
    await user.type(manual, "A manual review.");
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(copied).toEqual(["A manual review."]);
  });

  it("uses each prototype path card as the explicit Start action", async () => {
    const user = userEvent.setup();
    const starts: unknown[] = [];
    render(
      <MemoryRouter initialEntries={["/start/entry-challenge-demo"]}>
        <ReviewerApplication
          entryChallengeClient={{
            start: async (input) => {
              starts.push(input);
              return { redirectTo: "/review/review-session-demo" };
            },
            verify: async () => ({ status: "verification-unavailable" }),
            read: async () => ({
              status: "ready",
              entryChallengeHandle: "entry-challenge-demo",
              csrfToken: "csrf-token-with-at-least-thirty-two-characters",
              context: {
                tenantDisplayName: "Apex Dental",
                locationDisplayName: "Central Clinic",
                locale: "en-GB",
                entryMode: "invite",
                ratingRequired: true,
                requirements,
                factOptions: [],
                reviewFormats: entryReviewFormats,
                destinations,
              },
            }),
          }}
        />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "4, Good" }));
    await user.click(screen.getByRole("button", { name: "Improve my wording" }));

    await waitFor(() => {
      expect(starts).toEqual([
        expect.objectContaining({ action: "paraphrase", rating: 4 }),
      ]);
    });
  });

  it("starts and navigates with memory-only reviewer choices", async () => {
    const user = userEvent.setup();
    const starts: unknown[] = [];
    const navigations: string[] = [];
    render(
      <MemoryRouter initialEntries={["/start/entry-challenge-demo"]}>
        <ReviewerApplication
          entryChallengeClient={{
            start: async (input) => {
              starts.push(input);
              return { redirectTo: "/review/review-session-demo" };
            },
            verify: async () => ({ status: "verification-unavailable" }),
            read: async () => ({
              status: "ready",
              entryChallengeHandle: "entry-challenge-demo",
              csrfToken: "csrf-token-with-at-least-thirty-two-characters",
              context: {
                tenantDisplayName: "Apex Dental",
                locationDisplayName: "Central Clinic",
                locale: "en-GB",
                entryMode: "invite",
                ratingRequired: true,
                requirements,
                factOptions: [],
                reviewFormats: entryReviewFormats,
                destinations,
              },
            }),
          }}
          navigate={(path) => navigations.push(path)}
        />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "4, Good" }));
    await user.click(
      screen.getByRole("button", { name: "Pick what to mention" }),
    );

    await waitFor(() => {
      expect({ starts, navigations }).toEqual({
        starts: [
          {
            entryChallengeHandle: "entry-challenge-demo",
            rating: 4,
            action: "generate",
            csrfToken: "csrf-token-with-at-least-thirty-two-characters",
          },
        ],
        navigations: ["/review/review-session-demo"],
      });
    });
  });

  it("confirms an invited visit before creating the Review Session", async () => {
    const user = userEvent.setup();
    const verifications: unknown[] = [];
    const navigations: string[] = [];
    render(
      <MemoryRouter initialEntries={["/start/entry-challenge-demo"]}>
        <ReviewerApplication
          entryChallengeClient={{
            start: async () => ({ status: "verification-required" }),
            verify: async (input) => {
              verifications.push(input);
              return { redirectTo: "/review/review-session-demo" };
            },
            read: async () => ({
              status: "ready",
              entryChallengeHandle: "entry-challenge-demo",
              csrfToken: "csrf-token-with-at-least-thirty-two-characters",
              stage: "entry",
              provisionalSelection: null,
              context: {
                tenantDisplayName: "Apex Dental",
                locationDisplayName: "Central Clinic",
                locale: "en-GB",
                entryMode: "invite",
                ratingRequired: true,
                requirements,
                factOptions: [],
                reviewFormats: entryReviewFormats,
                destinations,
              },
            }),
          }}
          navigate={(path) => navigations.push(path)}
        />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "4, Good" }));
    await user.click(
      screen.getByRole("button", { name: "Pick what to mention" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Confirm your visit" }),
    ).toBeVisible();

    await user.type(
      screen.getByRole("textbox", { name: "Booking or receipt code" }),
      "BS-4471-K",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect({ verifications, navigations }).toEqual({
        verifications: [
          {
            entryChallengeHandle: "entry-challenge-demo",
            verificationEvidence: "BS-4471-K",
            csrfToken: "csrf-token-with-at-least-thirty-two-characters",
          },
        ],
        navigations: ["/review/review-session-demo"],
      });
    });
  });

  it("restores a localized pending verification choice after refresh", async () => {
    render(
      <MemoryRouter initialEntries={["/start/entry-challenge-demo"]}>
        <ReviewerApplication
          entryChallengeClient={{
            start: async () => {
              throw new Error("must not replay Start");
            },
            verify: async () => ({ status: "verification-unavailable" }),
            read: async () => ({
              status: "ready",
              entryChallengeHandle: "entry-challenge-demo",
              csrfToken: "csrf-token-with-at-least-thirty-two-characters",
              stage: "verification-required",
              provisionalSelection: { rating: 4, action: "paraphrase" },
              context: {
                tenantDisplayName: "Speicher Neun",
                locationDisplayName: "Speicher Neun · HafenCity",
                locale: "de-DE",
                entryMode: "invite",
                ratingRequired: true,
                requirements,
                factOptions: [],
                reviewFormats: entryReviewFormats,
                destinations,
              },
            }),
          }}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Bestätigen Sie Ihren Besuch",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Ihre Bewertung 4 von 5 und die Auswahl „Umformulieren“ sind gespeichert.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Buchungs- oder Belegcode" }),
    ).toBeVisible();
  });

  it("keeps an unaided writing path and the entered code when verification is unavailable", async () => {
    const user = userEvent.setup();
    const copied: string[] = [];
    render(
      <MemoryRouter initialEntries={["/start/entry-challenge-demo"]}>
        <ReviewerApplication
          entryChallengeClient={{
            start: async () => {
              throw new Error("must not replay Start");
            },
            verify: async () => ({ status: "verification-unavailable" }),
            read: async () => ({
              status: "ready",
              entryChallengeHandle: "entry-challenge-demo",
              csrfToken: "csrf-token-with-at-least-thirty-two-characters",
              stage: "verification-required",
              provisionalSelection: { rating: 4, action: "generate" },
              context: {
                tenantDisplayName: "Apex Dental",
                locationDisplayName: "Central Clinic",
                locale: "en-GB",
                entryMode: "invite",
                ratingRequired: true,
                requirements,
                factOptions: [],
                reviewFormats: entryReviewFormats,
                destinations,
              },
            }),
          }}
          copyText={async (text) => {
            copied.push(text);
          }}
        />
      </MemoryRouter>,
    );

    const evidence = await screen.findByRole("textbox", {
      name: "Booking or receipt code",
    });
    await user.type(evidence, "BS-4471-K");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("heading", {
        name: "Writing help needs a confirmed visit",
      }),
    ).toBeVisible();

    await user.type(
      screen.getByRole("textbox", { name: "Write your review yourself" }),
      "My own review.",
    );
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(copied).toEqual(["My own review."]);
    expect(
      screen.getByRole("link", { name: "Open Google Maps" }),
    ).toHaveAttribute("rel", expect.stringContaining("noopener"));

    await user.click(screen.getByRole("button", { name: "Back to the code" }));
    expect(
      screen.getByRole("textbox", { name: "Booking or receipt code" }),
    ).toHaveValue("BS-4471-K");
  });

  it("resumes a Review Session with its confirmed rating and Fact Options", async () => {
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements,
              factOptions: [
                {
                  id: "fact-attentive",
                  label: "The team was attentive",
                  categoryLabel: "Service",
                  polarity: "positive",
                },
              ],
              reviewFormats: [],
              destinations,
            }),
          }}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "What stood out?" }),
    ).toBeVisible();
    expect(screen.getByRole("group", { name: "Service" })).toBeVisible();
    expect(screen.getByText(/rating 4 of 5/)).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "The team was attentive" }),
    ).toBeVisible();
  });

  it("asks for the reviewer's source text before choosing a Paraphrase format", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "paraphrase",
              requirements,
              factOptions: [
                {
                  id: "fact-must-not-be-offered",
                  label: "A backend fact",
                  categoryLabel: "Service",
                  polarity: "positive",
                },
              ],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  availableCommands: ["paraphrase"],
                },
              ],
              destinations,
            }),
          }}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Paste your review" }),
    ).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    const source = screen.getByRole("textbox", {
      name: "Your review to reword",
    });
    const continueButton = screen.getByRole("button", {
      name: "Choose a format",
    });
    expect(continueButton).toBeDisabled();
    await user.type(source, "The fish was fresh and the team was attentive.");
    expect(continueButton).toBeEnabled();
    await user.click(continueButton);
    expect(
      screen.getByRole("heading", { name: "Pick a format" }),
    ).toBeVisible();
  });

  it("sends Paraphrase source text as its sole factual source", async () => {
    const user = userEvent.setup();
    const starts: unknown[] = [];
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "paraphrase",
              requirements,
              factOptions: [],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  availableCommands: ["paraphrase"],
                },
              ],
              destinations,
            }),
          }}
          generationClient={{
            async *start(input) {
              starts.push(input);
              yield {
                type: "terminal",
                status: "completed",
                draft: {
                  id: "draft-paraphrase",
                  generationId: "generation-paraphrase",
                  revision: 1,
                  text: "Attentive service and a calm waiting area.",
                  systemAnnotations: [],
                },
              } as const;
            },
          }}
          newIdempotencyKey={() => "paraphrase-request-a"}
        />
      </MemoryRouter>,
    );

    const sourceText =
      "The team was attentive and the waiting area was pleasantly calm.";
    await user.type(
      await screen.findByRole("textbox", { name: "Your review to reword" }),
      sourceText,
    );
    await user.click(screen.getByRole("button", { name: "Choose a format" }));
    await user.click(screen.getByRole("radio", { name: "Concise blurb" }));
    await user.click(screen.getByRole("button", { name: "Write the draft" }));

    expect(await screen.findByDisplayValue(/Attentive service/)).toBeVisible();
    expect(starts).toEqual([
      {
        reviewSessionHandle: "review-session-demo",
        idempotencyKey: "paraphrase-request-a",
        sourceText,
        reviewFormatId: "format-concise-v1",
      },
    ]);
  });

  it("persists confirmed input with optimistic concurrency before refresh can lose it", async () => {
    const user = userEvent.setup();
    const saves: unknown[] = [];
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements,
              factOptions: [
                {
                  id: "fact-attentive",
                  label: "The team was attentive",
                  categoryLabel: "Service",
                  polarity: "positive",
                },
              ],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  availableCommands: ["generate"],
                },
              ],
              destinations,
              progress: {
                epoch: 1,
                phase: "facts",
                selectedFactOptionIds: [],
                customerAssertion: "",
                sourceText: "",
                selectedReviewFormatId: null,
              },
              drafts: [],
            }),
          }}
          reviewProgressClient={{
            save: async (input) => {
              saves.push(input);
              return {
                status: "saved",
                progress: { epoch: saves.length + 1, ...input.progress },
              };
            },
          }}
        />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "The team was attentive" }),
    );
    await user.click(screen.getByRole("button", { name: "Choose a format" }));

    await waitFor(() =>
      expect(saves).toEqual([
        {
          reviewSessionHandle: "review-session-demo",
          expectedEpoch: 1,
          progress: {
            phase: "format",
            selectedFactOptionIds: ["fact-attentive"],
            customerAssertion: "",
            sourceText: "",
            selectedReviewFormatId: null,
          },
        },
      ]),
    );
  });

  it("flushes a newly selected Fact on pagehide before the debounce expires", async () => {
    const user = userEvent.setup();
    const saves: unknown[] = [];
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              ...resumableResult(),
              progress: {
                epoch: 1,
                phase: "facts",
                selectedFactOptionIds: [],
                customerAssertion: "",
                sourceText: "",
                selectedReviewFormatId: null,
              },
              drafts: [],
            }),
          }}
          reviewProgressClient={{
            save: async (input, options) => {
              saves.push({ input, options });
              return {
                status: "saved",
                progress: { epoch: input.expectedEpoch + 1, ...input.progress },
              };
            },
          }}
        />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "The team was attentive" }),
    );
    await act(async () => {
      globalThis.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(saves).toEqual([
        {
          input: {
            reviewSessionHandle: "review-session-demo",
            expectedEpoch: 1,
            progress: {
              phase: "facts",
              selectedFactOptionIds: ["fact-attentive"],
              customerAssertion: "",
              sourceText: "",
              selectedReviewFormatId: null,
            },
          },
          options: { keepalive: true },
        },
      ]),
    );
  });

  it("describes the reviewer assertion field with its limit and grounding guidance", async () => {
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements,
              factOptions: [],
              reviewFormats: [],
              destinations,
            }),
          }}
        />
      </MemoryRouter>,
    );

    const assertion = await screen.findByRole("textbox", {
      name: "Something else that happened (optional)",
    });
    expect(assertion).toHaveAccessibleDescription(
      "0 / 500 characters Write only a fact you personally assert is true. Maximum 500 characters.",
    );
  });

  it("does not treat typed reviewer text as an Assertion until it is explicitly confirmed", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements: { ...requirements, minimumFactSelections: 2 },
              factOptions: [],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  availableCommands: ["generate"],
                },
              ],
              destinations,
            }),
          }}
        />
      </MemoryRouter>,
    );

    const assertion = await screen.findByRole("textbox", {
      name: "Something else that happened (optional)",
    });
    const continueButton = screen.getByRole("button", {
      name: "Choose a format",
    });
    await user.type(assertion, "The reception was calm.");
    expect(continueButton).toBeDisabled();

    await user.click(
      screen.getByRole("button", { name: "Confirm this fact" }),
    );
    expect(screen.getByText("Fact confirmed.")).toBeVisible();
    expect(continueButton).toBeEnabled();

    await user.type(assertion, " Very quiet too.");
    expect(continueButton).toBeDisabled();
    expect(screen.queryByText("Fact confirmed.")).not.toBeInTheDocument();
  });

  it("moves confirmed facts into compatible Review Format choice", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements,
              factOptions: [
                {
                  id: "fact-attentive",
                  label: "The team was attentive",
                  categoryLabel: "Service",
                  polarity: "positive",
                },
              ],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  availableCommands: ["generate"],
                },
              ],
              destinations,
            }),
          }}
        />
      </MemoryRouter>,
    );

    const fact = await screen.findByRole("checkbox", {
      name: "The team was attentive",
    });
    expect(screen.getByText(/Pick at least 1 things/)).toBeVisible();
    await user.click(fact);
    expect(screen.queryByText(/Pick at least 1 things/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choose a format" }));

    expect(
      screen.getByRole("heading", { name: "Pick a format" }),
    ).toBeVisible();
    expect(
      screen.getByRole("radio", { name: "Concise blurb" }),
    ).toBeVisible();
    expect(screen.getByText("One concise paragraph.")).toBeVisible();
    expect(screen.getByText("The team was attentive.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("heading", { name: "What stood out?" }),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "The team was attentive" }),
    ).toBeChecked();
  });

  it("describes each Review Format choice with its purpose, limits and sample", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements,
              factOptions: [
                {
                  id: "fact-attentive",
                  label: "The team was attentive",
                  categoryLabel: "Service",
                  polarity: "positive",
                },
              ],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  availableCommands: ["generate"],
                },
              ],
              destinations,
            }),
          }}
        />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "The team was attentive" }),
    );
    await user.click(screen.getByRole("button", { name: "Choose a format" }));

    expect(screen.getByRole("radio", { name: "Concise blurb" }))
      .toHaveAccessibleDescription(
        "One concise paragraph. 20–420 characters The team was attentive.",
      );
  });

  it("moves focus to the new heading when the reviewer changes journey step", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements,
              factOptions: [
                {
                  id: "fact-attentive",
                  label: "The team was attentive",
                  categoryLabel: "Service",
                  polarity: "positive",
                },
              ],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  availableCommands: ["generate"],
                },
              ],
              destinations,
            }),
          }}
        />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "The team was attentive" }),
    );
    await user.click(screen.getByRole("button", { name: "Choose a format" }));
    const heading = screen.getByRole("heading", { name: "Pick a format" });

    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("uses browser Back to return from Format without reopening the consumed link", async () => {
    const user = userEvent.setup();
    globalThis.history.replaceState(
      null,
      "",
      "/review/review-session-browser-back",
    );
    render(
      <BrowserRouter>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-browser-back",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements,
              factOptions: [
                {
                  id: "fact-attentive",
                  label: "The team was attentive",
                  categoryLabel: "Service",
                  polarity: "positive",
                },
              ],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  availableCommands: ["generate"],
                },
              ],
              destinations,
            }),
          }}
        />
      </BrowserRouter>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "The team was attentive" }),
    );
    await user.click(screen.getByRole("button", { name: "Choose a format" }));
    expect(globalThis.location.pathname).toBe(
      "/review/review-session-browser-back",
    );
    expect(globalThis.location.search).toBe("?step=format");

    act(() => {
      globalThis.history.replaceState(
        null,
        "",
        "/review/review-session-browser-back",
      );
      globalThis.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(
      await screen.findByRole("heading", { name: "What stood out?" }),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "The team was attentive" }),
    ).toBeChecked();
    globalThis.history.replaceState(null, "", "/");
  });

  it("shows only progress until a terminal grounded Draft arrives", async () => {
    const user = userEvent.setup();
    const starts: unknown[] = [];
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements,
              factOptions: [
                {
                  id: "fact-attentive",
                  label: "The team was attentive",
                  categoryLabel: "Service",
                  polarity: "positive",
                },
              ],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  availableCommands: ["generate"],
                },
              ],
              destinations,
            }),
          }}
          generationClient={{
            async *start(input) {
              starts.push(input);
              yield { type: "accepted" } as const;
              yield {
                type: "progress",
                phase: "validating",
                elapsedSeconds: 12,
              } as const;
              yield {
                type: "terminal",
                status: "completed",
                draft: {
                  id: "draft-a",
                  generationId: "generation-a",
                  revision: 1,
                  text: "The team was attentive.",
                  systemAnnotations: [],
                },
              } as const;
            },
          }}
          newIdempotencyKey={() => "generation-request-a"}
        />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "The team was attentive" }),
    );
    await user.type(
      screen.getByLabelText("Something else that happened (optional)"),
      "The reception was calm.",
    );
    await user.click(
      screen.getByRole("button", { name: "Confirm this fact" }),
    );
    await user.click(screen.getByRole("button", { name: "Choose a format" }));
    await user.click(screen.getByRole("radio", { name: "Concise blurb" }));
    await user.click(screen.getByRole("button", { name: "Write the draft" }));

    expect(
      await screen.findByRole("heading", { name: "Here it is" }),
    ).toBeVisible();
    expect(screen.getByText("The team was attentive.")).toBeVisible();
    const provenance = screen
      .getByText(/What this draft is built on/)
      .closest("details");
    expect(provenance).toHaveTextContent("The team was attentive");
    expect(provenance).toHaveTextContent("The reception was calm.");
    expect(starts).toEqual([
      {
        reviewSessionHandle: "review-session-demo",
        idempotencyKey: "generation-request-a",
        factOptionIds: ["fact-attentive"],
        reviewFormatId: "format-concise-v1",
        customerAssertion: "The reception was calm.",
      },
    ]);
  });

  it("offers a recoverable failure state when Generation is rejected", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements,
              factOptions: [
                {
                  id: "fact-attentive",
                  label: "The team was attentive",
                  categoryLabel: "Service",
                  polarity: "positive",
                },
              ],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  availableCommands: ["generate"],
                },
              ],
              destinations,
            }),
          }}
          generationClient={{
            async *start() {
              yield {
                type: "terminal",
                status: "rejected",
                code: "PROVIDER_UNAVAILABLE",
                retryable: true,
              } as const;
            },
          }}
          newIdempotencyKey={() => "generation-request-a"}
        />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "The team was attentive" }),
    );
    await user.click(screen.getByRole("button", { name: "Choose a format" }));
    await user.click(screen.getByRole("radio", { name: "Concise blurb" }));
    await user.click(screen.getByRole("button", { name: "Write the draft" }));

    expect(
      await screen.findByRole("heading", { name: "We couldn't create a draft" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.getByText(/write it yourself/i)).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Write your review yourself" }),
    ).toBeVisible();
  });

  it("returns a Format rejection directly to the retained Format choice", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              ...resumableResult(),
              progress: undefined,
              drafts: undefined,
            }),
          }}
          generationClient={{
            async *start() {
              yield {
                type: "terminal",
                status: "rejected",
                code: "FORMAT_REJECTED",
                retryable: false,
              } as const;
            },
          }}
          newIdempotencyKey={() => "generation-request-a"}
        />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "The team was attentive" }),
    );
    await user.click(screen.getByRole("button", { name: "Choose a format" }));
    await user.click(screen.getByRole("radio", { name: "Concise blurb" }));
    await user.click(screen.getByRole("button", { name: "Write the draft" }));
    expect(
      await screen.findByRole("heading", {
        name: "The selected format could not be satisfied",
      }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Change format" }));
    expect(screen.getByRole("heading", { name: "Pick a format" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "Concise blurb" })).toBeChecked();
  });

  it("honours an application Retry-After before offering another paid request", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements,
              factOptions: [
                {
                  id: "fact-attentive",
                  label: "The team was attentive",
                  categoryLabel: "Service",
                  polarity: "positive",
                },
              ],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  availableCommands: ["generate"],
                },
              ],
              destinations,
            }),
          }}
          generationClient={{
            async *start() {
              yield {
                type: "terminal",
                status: "rejected",
                code: "RATE_LIMITED",
                retryable: true,
                retryAfterSeconds: 4,
              } as const;
            },
          }}
          newIdempotencyKey={() => "generation-request-a"}
        />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "The team was attentive" }),
    );
    await user.click(screen.getByRole("button", { name: "Choose a format" }));
    await user.click(screen.getByRole("radio", { name: "Concise blurb" }));
    await user.click(screen.getByRole("button", { name: "Write the draft" }));

    expect(
      await screen.findByRole("heading", { name: "A few too many requests" }),
    ).toBeVisible();
    expect(screen.getByText("Try again in 4 seconds.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
  });

  it("reconnects with the same idempotency key after a transport failure", async () => {
    const user = userEvent.setup();
    const starts: unknown[] = [];
    let keyNumber = 0;
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              ...resumableResult(),
              progress: undefined,
              drafts: undefined,
            }),
          }}
          generationClient={{
            async *start(input) {
              starts.push(input);
              if (starts.length === 1) {
                throw new GenerationTransportError(
                  "GENERATION_UNAVAILABLE",
                  true,
                );
              }
              yield {
                type: "terminal",
                status: "completed",
                draft: {
                  id: "draft-a",
                  generationId: "generation-a",
                  revision: 1,
                  text: "The team was attentive.",
                  systemAnnotations: [],
                },
              } as const;
            },
          }}
          newIdempotencyKey={() => `generation-request-${++keyNumber}`}
        />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "The team was attentive" }),
    );
    await user.click(screen.getByRole("button", { name: "Choose a format" }));
    await user.click(screen.getByRole("radio", { name: "Concise blurb" }));
    await user.click(screen.getByRole("button", { name: "Write the draft" }));
    await user.click(
      await screen.findByRole("button", { name: "Try again" }),
    );

    expect(await screen.findByDisplayValue("The team was attentive.")).toBeVisible();
    expect(starts).toEqual([
      expect.objectContaining({ idempotencyKey: "generation-request-1" }),
      expect.objectContaining({ idempotencyKey: "generation-request-1" }),
    ]);
    expect(keyNumber).toBe(2);
  });

  it("preserves a usable manual review path when assisted budget is unavailable", async () => {
    const user = userEvent.setup();
    const copied: string[] = [];
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements,
              factOptions: [
                {
                  id: "fact-attentive",
                  label: "The team was attentive",
                  categoryLabel: "Service",
                  polarity: "positive",
                },
              ],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  availableCommands: ["generate"],
                },
              ],
              destinations,
            }),
          }}
          generationClient={{
            async *start() {
              yield {
                type: "terminal",
                status: "rejected",
                code: "BUDGET_EXCEEDED",
                retryable: false,
              } as const;
            },
          }}
          copyText={async (text) => {
            copied.push(text);
          }}
          newIdempotencyKey={() => "generation-request-a"}
        />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "The team was attentive" }),
    );
    await user.click(screen.getByRole("button", { name: "Choose a format" }));
    await user.click(screen.getByRole("radio", { name: "Concise blurb" }));
    await user.click(screen.getByRole("button", { name: "Write the draft" }));

    expect(
      await screen.findByRole("heading", {
        name: "Writing assistance is temporarily unavailable",
      }),
    ).toBeVisible();
    const manual = screen.getByLabelText("Write your review yourself");
    await user.type(manual, "The team was attentive.");
    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(copied).toEqual(["The team was attentive."]);
    expect(screen.getByRole("link", { name: "Open Google Maps" })).toHaveAttribute(
      "href",
      "https://example.test/review",
    );
  });

  it("copies only the terminal Draft and keeps a manual selection fallback", async () => {
    const user = userEvent.setup();
    const copied: string[] = [];
    const dispositions: unknown[] = [];
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements,
              factOptions: [
                {
                  id: "fact-attentive",
                  label: "The team was attentive",
                  categoryLabel: "Service",
                  polarity: "positive",
                },
              ],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  availableCommands: ["generate"],
                },
              ],
              destinations,
            }),
          }}
          generationClient={{
            async *start() {
              yield {
                type: "terminal",
                status: "completed",
                draft: {
                  id: "draft-a",
                  generationId: "generation-a",
                  revision: 1,
                  text: "The team was attentive.",
                  systemAnnotations: [],
                },
              } as const;
            },
          }}
          reviewerDispositionClient={{
            record: async (input) => {
              dispositions.push(input);
              return {
                status: "recorded",
                kind: "edited",
                revision: 2,
                normalizedEditDistance: 0.21,
              };
            },
          }}
          copyText={async (text) => {
            copied.push(text);
          }}
          newIdempotencyKey={() => "generation-request-a"}
        />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "The team was attentive" }),
    );
    await user.click(screen.getByRole("button", { name: "Choose a format" }));
    await user.click(screen.getByRole("radio", { name: "Concise blurb" }));
    await user.click(screen.getByRole("button", { name: "Write the draft" }));

    const draft = await screen.findByRole("textbox", {
      name: "Your draft — edit it freely",
    });
    await user.clear(draft);
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    await user.type(draft, "The team was exceptionally attentive.");
    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(copied).toEqual(["The team was exceptionally attentive."]);
    await waitFor(() =>
      expect(dispositions).toEqual([
        {
          reviewSessionHandle: "review-session-demo",
          idempotencyKey: "generation-request-a",
          draftId: "draft-a",
          generationId: "generation-a",
          finalText: "The team was exceptionally attentive.",
        },
      ]),
    );
    expect(
      await screen.findByRole("heading", { name: "Your review is ready" }),
    ).toBeVisible();
    expect(screen.getByText("The team was exceptionally attentive.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Google Maps" })).toHaveAttribute(
      "href",
      "https://example.test/review",
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("does not claim completion when recording the reviewer disposition fails", async () => {
    const user = userEvent.setup();
    const copied: string[] = [];
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements,
              factOptions: [
                {
                  id: "fact-attentive",
                  label: "The team was attentive",
                  categoryLabel: "Service",
                  polarity: "positive",
                },
              ],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  availableCommands: ["generate"],
                },
              ],
              destinations,
            }),
          }}
          generationClient={{
            async *start() {
              yield {
                type: "terminal",
                status: "completed",
                draft: {
                  id: "draft-a",
                  generationId: "generation-a",
                  revision: 1,
                  text: "The team was attentive.",
                  systemAnnotations: [],
                },
              } as const;
            },
          }}
          reviewerDispositionClient={{
            record: async () => {
              throw new Error("DISPOSITION_UNAVAILABLE");
            },
          }}
          copyText={async (text) => {
            copied.push(text);
          }}
          newIdempotencyKey={() => "generation-request-a"}
        />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "The team was attentive" }),
    );
    await user.click(screen.getByRole("button", { name: "Choose a format" }));
    await user.click(screen.getByRole("radio", { name: "Concise blurb" }));
    await user.click(screen.getByRole("button", { name: "Write the draft" }));
    await user.click(
      await screen.findByRole("button", { name: "Copy" }),
    );

    expect(copied).toEqual(["The team was attentive."]);
    expect(
      await screen.findByText(
        "Copied, but completion could not be recorded. Please try again.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Your review is ready" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Your draft — edit it freely" }),
    ).toBeVisible();
  });

  it("rehydrates persisted Done and keeps a manual Copy Again fallback", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              ...resumableResult(),
              progress: {
                ...resumableResult().progress!,
                phase: "done",
              },
            }),
          }}
          copyText={async () => {
            throw new Error("CLIPBOARD_UNAVAILABLE");
          }}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Your review is ready" }),
    ).toBeVisible();
    expect(screen.getByText("The team was attentive.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Copy again" }));
    expect(
      await screen.findByText("Select the review text and copy it manually."),
    ).toBeVisible();
  });

  it("persists Done only after the final Disposition is recorded", async () => {
    const user = userEvent.setup();
    const progressWrites: unknown[] = [];
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{ read: async () => resumableResult() }}
          reviewProgressClient={{
            save: async (input) => {
              progressWrites.push(input);
              return {
                status: "saved",
                progress: { epoch: input.expectedEpoch + 1, ...input.progress },
              };
            },
          }}
          reviewerDispositionClient={{
            record: async () => ({
              status: "recorded",
              kind: "accepted",
              revision: 1,
              normalizedEditDistance: 0,
            }),
          }}
          copyText={async () => undefined}
          newIdempotencyKey={() => "disposition-done"}
        />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "Copy" }));
    expect(
      await screen.findByRole("heading", { name: "Your review is ready" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(progressWrites).toContainEqual({
        reviewSessionHandle: "review-session-demo",
        expectedEpoch: 3,
        progress: {
          phase: "done",
          selectedFactOptionIds: ["fact-attentive"],
          customerAssertion: "",
          sourceText: "",
          selectedReviewFormatId: "format-concise-v1",
        },
      }),
    );
  });

  it("shows backend format limits and marks manual edits without blocking copy", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements,
              factOptions: [
                {
                  id: "fact-attentive",
                  label: "The team was attentive",
                  categoryLabel: "Service",
                  polarity: "positive",
                },
              ],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  constraints: { minChars: 20, maxChars: 30 },
                  availableCommands: ["generate"],
                },
              ],
              destinations,
            }),
          }}
          generationClient={{
            async *start() {
              yield {
                type: "terminal",
                status: "completed",
                draft: {
                  id: "draft-a",
                  generationId: "generation-a",
                  revision: 1,
                  text: "The team was attentive.",
                  systemAnnotations: [],
                },
              } as const;
            },
          }}
          newIdempotencyKey={() => "generation-request-a"}
        />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "The team was attentive" }),
    );
    await user.click(screen.getByRole("button", { name: "Choose a format" }));
    expect(screen.getByText("20–30 characters")).toBeVisible();
    await user.click(screen.getByRole("radio", { name: "Concise blurb" }));
    await user.click(screen.getByRole("button", { name: "Write the draft" }));

    const draft = await screen.findByRole("textbox", {
      name: "Your draft — edit it freely",
    });
    await user.type(draft, " This is now deliberately too long.");

    expect(screen.getByText("Edited by you")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This format works best between 20 and 30 characters",
    );
    expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
  });

  it("autosaves the latest reviewer edit as one optimistic Draft revision", async () => {
    const user = userEvent.setup();
    const saves: unknown[] = [];
    let key = 0;
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{ read: async () => resumableResult() }}
          reviewerDraftRevisionClient={{
            save: async (input) => {
              saves.push(input);
              return { status: "recorded", revision: 2 };
            },
          }}
          newIdempotencyKey={() => `draft-save-${++key}`}
        />
      </MemoryRouter>,
    );

    const draft = await screen.findByRole("textbox", {
      name: "Your draft — edit it freely",
    });
    await user.clear(draft);
    await user.type(draft, "The team was exceptionally attentive.");

    await waitFor(
      () =>
        expect(saves).toEqual([
          {
            reviewSessionHandle: "review-session-demo",
            idempotencyKey: "draft-save-1",
            draftId: "draft-a",
            generationId: "generation-a",
            expectedRevision: 1,
            text: "The team was exceptionally attentive.",
          },
        ]),
      { timeout: 2_000 },
    );
    expect(await screen.findByText("Changes saved.")).toBeVisible();
  });

  it("flushes the latest Draft edit on pagehide before autosave debounce", async () => {
    const user = userEvent.setup();
    const saves: unknown[] = [];
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{ read: async () => resumableResult() }}
          reviewerDraftRevisionClient={{
            save: async (input, options) => {
              saves.push({ input, options });
              return { status: "recorded", revision: 2 };
            },
          }}
          newIdempotencyKey={() => "draft-pagehide-a"}
        />
      </MemoryRouter>,
    );

    const draft = await screen.findByRole("textbox", {
      name: "Your draft — edit it freely",
    });
    await user.clear(draft);
    await user.type(draft, "The team listened carefully.");
    await act(async () => {
      globalThis.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(saves).toEqual([
        {
          input: {
            reviewSessionHandle: "review-session-demo",
            idempotencyKey: "draft-pagehide-a",
            draftId: "draft-a",
            generationId: "generation-a",
            expectedRevision: 1,
            text: "The team listened carefully.",
          },
          options: { keepalive: true },
        },
      ]),
    );
  });

  it("renders policy disclosure outside the editable body and never submits it as reviewer text", async () => {
    const user = userEvent.setup();
    const disclosure =
      "Review generated with AI assistance on behalf of Apex Dental.";
    const saves: unknown[] = [];
    const dispositions: unknown[] = [];
    const copied: string[] = [];
    let key = 0;
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              ...resumableResult(),
              drafts: [
                {
                  ...resumableResult().drafts![0]!,
                  systemAnnotations: [
                    {
                      kind: "assisted-review-disclosure",
                      text: disclosure,
                      policyVersionId: "tenant-policy-r7",
                    },
                  ],
                },
              ],
            }),
          }}
          reviewerDraftRevisionClient={{
            save: async (input) => {
              saves.push(input);
              return { status: "recorded", revision: 2 };
            },
          }}
          reviewerDispositionClient={{
            record: async (input) => {
              dispositions.push(input);
              return {
                status: "recorded",
                kind: "edited",
                revision: 2,
                normalizedEditDistance: 0.1,
              };
            },
          }}
          copyText={async (text) => {
            copied.push(text);
          }}
          newIdempotencyKey={() => `review-write-${++key}`}
        />
      </MemoryRouter>,
    );

    const body = await screen.findByRole("textbox", {
      name: "Your draft — edit it freely",
    });
    expect(body).toHaveValue("The team was attentive.");
    expect(screen.getByText(disclosure)).toBeVisible();
    expect(screen.getByText(disclosure)).not.toHaveAttribute("contenteditable");

    await user.clear(body);
    await user.type(body, "The team was exceptionally attentive.");
    await waitFor(
      () =>
        expect(saves).toContainEqual(
          expect.objectContaining({
            text: "The team was exceptionally attentive.",
          }),
        ),
      { timeout: 2_000 },
    );
    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(copied).toEqual([
      `The team was exceptionally attentive.\n\n${disclosure}`,
    ]);
    await waitFor(() =>
      expect(dispositions).toContainEqual(
        expect.objectContaining({
          finalText: "The team was exceptionally attentive.",
        }),
      ),
    );
  });

  it("stops Draft autosave after an optimistic conflict instead of overwriting another tab", async () => {
    const user = userEvent.setup();
    const saves: unknown[] = [];
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{ read: async () => resumableResult() }}
          reviewerDraftRevisionClient={{
            save: async (input) => {
              saves.push(input);
              return { status: "conflict", revision: 3 };
            },
          }}
          newIdempotencyKey={() => "draft-save-conflict"}
        />
      </MemoryRouter>,
    );

    const draft = await screen.findByRole("textbox", {
      name: "Your draft — edit it freely",
    });
    await user.type(draft, " Changed here.");
    expect(
      await screen.findByText(
        "This draft changed in another tab. Reload before editing again.",
        {},
        { timeout: 2_000 },
      ),
    ).toBeVisible();
    await user.type(draft, " Must not overwrite.");
    await new Promise((resolve) => globalThis.setTimeout(resolve, 750));
    expect(saves).toHaveLength(1);
  });

  it("requires confirmation before forgetting only this browser-bound review", async () => {
    const user = userEvent.setup();
    const forgotten: unknown[] = [];
    const navigations: string[] = [];
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{ read: async () => resumableResult() }}
          reviewSessionForgetClient={{
            forget: async (input) => {
              forgotten.push(input);
            },
          }}
          navigate={(path) => navigations.push(path)}
        />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("button", { name: "Forget this review" }),
    );
    expect(forgotten).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Confirm forget" }));

    await waitFor(() => {
      expect(forgotten).toEqual([
        { reviewSessionHandle: "review-session-demo" },
      ]);
      expect(navigations).toEqual(["/"]);
    });
  });

  it("lets the reviewer abort generation without exposing partial text", async () => {
    const user = userEvent.setup();
    let observedSignal: AbortSignal | undefined;
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements,
              factOptions: [
                {
                  id: "fact-attentive",
                  label: "The team was attentive",
                  categoryLabel: "Service",
                  polarity: "positive",
                },
              ],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  availableCommands: ["generate"],
                },
              ],
              destinations,
            }),
          }}
          generationClient={{
            async *start(_input, signal) {
              observedSignal = signal;
              yield {
                type: "progress",
                phase: "generating",
                elapsedSeconds: 7,
              } as const;
              await new Promise<void>((resolve) => {
                signal.addEventListener("abort", () => resolve(), { once: true });
              });
            },
          }}
          newIdempotencyKey={() => "generation-request-a"}
        />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "The team was attentive" }),
    );
    await user.click(screen.getByRole("button", { name: "Choose a format" }));
    await user.click(screen.getByRole("radio", { name: "Concise blurb" }));
    await user.click(screen.getByRole("button", { name: "Write the draft" }));

    expect(await screen.findByText("Generating · 7s")).toBeVisible();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Generating · 7s");
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Only supported wording",
    );
    await user.click(screen.getByRole("button", { name: "Stop waiting" }));

    expect(observedSignal?.aborted).toBe(true);
    expect(
      await screen.findByRole("heading", { name: "Stopped waiting" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "No partial text was shown. The request may still finish; Try again reconnects to the same request.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Write your review yourself" }),
    ).toHaveValue("");
    expect(screen.queryByText(/unsafe partial/i)).not.toBeInTheDocument();
  });
});

describe("reworking a draft from the result screen", () => {
  it("does not offer Reformat from Done when the server projection omits it", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements,
              factOptions: [
                {
                  id: "fact-attentive",
                  label: "The team was attentive",
                  categoryLabel: "Service",
                  polarity: "positive",
                },
              ],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  availableCommands: ["generate"],
                },
                {
                  ...entryReviewFormats[0]!,
                  id: "format-detailed-v1",
                  displayName: "Detailed review",
                  availableCommands: [],
                },
              ],
              destinations,
              progress: {
                epoch: 3,
                phase: "results",
                selectedFactOptionIds: ["fact-attentive"],
                customerAssertion: "",
                sourceText: "",
                selectedReviewFormatId: "format-concise-v1",
              },
              drafts: [
                {
                  id: "draft-a",
                  generationId: "generation-a",
                  revision: 1,
                  text: "The team was attentive.",
                  systemAnnotations: [],
                },
              ],
            }),
          }}
          reviewerDispositionClient={{
            record: async () => ({
              status: "recorded",
              kind: "accepted",
              revision: 1,
              normalizedEditDistance: 0,
            }),
          }}
          copyText={async () => undefined}
          newIdempotencyKey={() => "disposition-a"}
        />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "Copy" }));
    await screen.findByRole("heading", { name: "Your review is ready" });
    expect(
      screen.queryByRole("button", {
        name: "Write another in a different format",
      }),
    ).not.toBeInTheDocument();
  });

  it("does not offer Resample before immutable source-Generation evidence is implemented", async () => {
    const user = userEvent.setup();
    const commands: unknown[] = [];
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements,
              factOptions: [
                {
                  id: "fact-attentive",
                  label: "The team was attentive",
                  categoryLabel: "Service",
                  polarity: "positive",
                },
              ],
              reviewFormats: [
                { ...entryReviewFormats[0]!, availableCommands: ["generate"] },
              ],
              destinations,
            }),
          }}
          generationClient={{
            async *start(input) {
              commands.push(input);
              yield {
                type: "terminal",
                status: "completed",
                draft: {
                  id: `draft-${commands.length}`,
                  generationId: `generation-${commands.length}`,
                  revision: 1,
                  text: `Draft ${commands.length}.`,
                  systemAnnotations: [],
                },
              } as const;
            },
          }}
          newIdempotencyKey={() => `key-${commands.length + 1}`}
          copyText={async () => undefined}
        />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "The team was attentive" }),
    );
    await user.click(screen.getByRole("button", { name: "Choose a format" }));
    await user.click(screen.getByRole("radio", { name: "Concise blurb" }));
    await user.click(screen.getByRole("button", { name: "Write the draft" }));

    expect(await screen.findByDisplayValue("Draft 1.")).toBeVisible();

    expect(
      screen.queryByRole("button", { name: "Write it again" }),
    ).not.toBeInTheDocument();
    expect(commands).toEqual([
      {
        reviewSessionHandle: "review-session-demo",
        idempotencyKey: "key-1",
        factOptionIds: ["fact-attentive"],
        reviewFormatId: "format-concise-v1",
      },
    ]);
  });

  it("hides transformations omitted from the server's executable projection", async () => {
    const user = userEvent.setup();
    const starts: Array<Record<string, unknown>> = [];
    render(
      <MemoryRouter initialEntries={["/review/review-session-demo"]}>
        <ReviewerApplication
          reviewSessionClient={{
            read: async () => ({
              status: "ready",
              reviewSessionHandle: "review-session-demo",
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              rating: 4,
              action: "generate",
              requirements,
              factOptions: [
                {
                  id: "fact-attentive",
                  label: "The team was attentive",
                  categoryLabel: "Service",
                  polarity: "positive",
                },
              ],
              reviewFormats: [
                {
                  ...entryReviewFormats[0]!,
                  availableCommands: ["generate"],
                },
              ],
              destinations,
            }),
          }}
          generationClient={{
            async *start(input) {
              starts.push(input as unknown as Record<string, unknown>);
              const number = starts.length;
              yield {
                type: "terminal",
                status: "completed",
                draft: {
                  id: `draft-${number}`,
                  generationId: `generation-${number}`,
                  revision: 1,
                  text:
                    number === 1
                      ? "The team was attentive throughout the visit and the service felt calm."
                      : `Transformed draft ${number}.`,
                  systemAnnotations: [],
                },
              } as const;
            },
          }}
          newIdempotencyKey={() => `key-${starts.length + 1}`}
        />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "The team was attentive" }),
    );
    await user.click(screen.getByRole("button", { name: "Choose a format" }));
    await user.click(screen.getByRole("radio", { name: "Concise blurb" }));
    await user.click(screen.getByRole("button", { name: "Write the draft" }));

    await screen.findByDisplayValue(
      "The team was attentive throughout the visit and the service felt calm.",
    );
    expect(screen.queryByRole("button", { name: "Make it shorter" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make it longer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Wording instruction" })).not.toBeInTheDocument();
    expect(starts).toHaveLength(1);
  });
});
