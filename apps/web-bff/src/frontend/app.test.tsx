/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ReviewerApplication } from "./app.js";

describe("reviewer application routes", () => {
  it("shows an accessible loading projection while a clean Start route is prepared", () => {
    render(
      <MemoryRouter initialEntries={["/start/challenge-demo"]}>
        <ReviewerApplication />
      </MemoryRouter>,
    );

    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  });
});
