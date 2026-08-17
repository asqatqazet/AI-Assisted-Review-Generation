/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { ReviewerApplication } from "./app.js";

afterEach(cleanup);

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
      await screen.findByRole("heading", { name: "Operator console" }),
    ).toBeVisible();
  });

  it("renders the prepared business and rating question on the Start route", async () => {
    render(
      <MemoryRouter initialEntries={["/start/entry-challenge-demo"]}>
        <ReviewerApplication
          entryChallengeClient={{
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
                factOptions: [],
                reviewFormats: [],
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
                factOptions: [],
                reviewFormats: [],
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
                factOptions: [],
                reviewFormats: [],
              },
            }),
          }}
        />
      </MemoryRouter>,
    );

    const generate = await screen.findByRole("button", {
      name: "Generate from my facts",
    });
    expect(generate).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "4, Good" }));

    expect(generate).toBeEnabled();
  });

  it("retains exactly one reviewer-selected drafting path", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/start/entry-challenge-demo"]}>
        <ReviewerApplication
          entryChallengeClient={{
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
                factOptions: [],
                reviewFormats: [],
              },
            }),
          }}
        />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "4, Good" }));
    const generate = screen.getByRole("button", {
      name: "Generate from my facts",
    });
    const paraphrase = screen.getByRole("button", {
      name: "Improve my wording",
    });

    await user.click(generate);
    expect(generate).toHaveAttribute("aria-pressed", "true");
    expect(paraphrase).toHaveAttribute("aria-pressed", "false");

    await user.click(paraphrase);
    expect(generate).toHaveAttribute("aria-pressed", "false");
    expect(paraphrase).toHaveAttribute("aria-pressed", "true");
  });

  it("builds an explicit Start command from memory-only reviewer choices", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/start/entry-challenge-demo"]}>
        <ReviewerApplication
          entryChallengeClient={{
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
                factOptions: [],
                reviewFormats: [],
              },
            }),
          }}
        />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "4, Good" }));
    await user.click(
      screen.getByRole("button", { name: "Generate from my facts" }),
    );

    const start = screen.getByRole("button", { name: "Start" });
    const form = start.closest("form");

    expect(start).toBeEnabled();
    expect(form).toHaveAttribute(
      "action",
      "/api/v1/entry-challenges/entry-challenge-demo/start",
    );
    expect(form).toHaveAttribute("method", "post");
    expect(Object.fromEntries(new FormData(form as HTMLFormElement))).toEqual({
      rating: "4",
      action: "generate",
      csrfToken: "csrf-token-with-at-least-thirty-two-characters",
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
    expect(screen.getByText("4 out of 5")).toBeVisible();
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
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", { name: "Choose a format" }),
    ).toBeVisible();
    expect(
      screen.getByRole("radio", { name: "Concise blurb" }),
    ).toBeVisible();
  });
});
