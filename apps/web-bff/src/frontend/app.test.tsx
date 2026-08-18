/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import type { EntryChallengeProjectionDto } from "@review/contracts/context";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { ReviewerApplication } from "./app.js";

afterEach(cleanup);

const requirements = {
  minimumFactSelections: 1,
  maximumReviewFormatsPerGeneration: 1,
} as const;

const entryReviewFormats: EntryChallengeProjectionDto["context"]["reviewFormats"] = [
  {
    id: "format-concise-v1",
    displayName: "Concise blurb",
    description: "One concise paragraph.",
    sample: "The team was attentive.",
    availableCommands: ["generate", "paraphrase"],
  },
];

describe("reviewer application routes", () => {
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

  it("loads the Operator Console only for a Console route", async () => {
    render(
      <MemoryRouter initialEntries={["/console"]}>
        <ReviewerApplication />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Overview" }),
    ).toBeVisible();
    expect(screen.getByText("No operating data loaded")).toBeVisible();
  });

  it("renders the prepared business and rating question on the Start route", async () => {
    render(
      <MemoryRouter initialEntries={["/start/entry-challenge-demo"]}>
        <ReviewerApplication
          entryChallengeClient={{
            start: async () => ({ redirectTo: "/review/review-session-demo" }),
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

  it("lets the reviewer select one clearly named rating", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/start/entry-challenge-demo"]}>
        <ReviewerApplication
          entryChallengeClient={{
            start: async () => ({ redirectTo: "/review/review-session-demo" }),
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
                  id: "format-concise-v1",
                  displayName: "Concise blurb",
                  description: "One concise paragraph.",
                  sample: "The team was attentive.",
                  availableCommands: ["generate"],
                },
              ],
            }),
          }}
        />
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "The team was attentive" }),
    );
    await user.click(screen.getByRole("button", { name: "Choose a format" }));

    expect(
      screen.getByRole("heading", { name: "Pick a format" }),
    ).toBeVisible();
    expect(
      screen.getByRole("radio", { name: "Concise blurb" }),
    ).toBeVisible();
    expect(screen.getByText("One concise paragraph.")).toBeVisible();
    expect(screen.getByText("The team was attentive.")).toBeVisible();
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
                  id: "format-concise-v1",
                  displayName: "Concise blurb",
                  description: "One concise paragraph.",
                  sample: "The team was attentive.",
                  availableCommands: ["generate"],
                },
              ],
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
    await user.click(screen.getByRole("radio", { name: "Concise blurb" }));
    await user.click(screen.getByRole("button", { name: "Write the draft" }));

    expect(
      await screen.findByRole("heading", { name: "Here it is" }),
    ).toBeVisible();
    expect(screen.getByText("The team was attentive.")).toBeVisible();
    expect(starts).toEqual([
      {
        reviewSessionHandle: "review-session-demo",
        idempotencyKey: "generation-request-a",
        factOptionIds: ["fact-attentive"],
        reviewFormatId: "format-concise-v1",
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
                  id: "format-concise-v1",
                  displayName: "Concise blurb",
                  description: "One concise paragraph.",
                  sample: "The team was attentive.",
                  availableCommands: ["generate"],
                },
              ],
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
  });

  it("copies only the terminal Draft and keeps a manual selection fallback", async () => {
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
                  id: "format-concise-v1",
                  displayName: "Concise blurb",
                  description: "One concise paragraph.",
                  sample: "The team was attentive.",
                  availableCommands: ["generate"],
                },
              ],
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
                },
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

    const draft = await screen.findByRole("textbox", {
      name: "Your draft — edit it freely",
    });
    await user.clear(draft);
    await user.type(draft, "The team was exceptionally attentive.");
    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(copied).toEqual(["The team was exceptionally attentive."]);
    expect(draft).toHaveValue(
      "The team was exceptionally attentive.",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
  });
});
