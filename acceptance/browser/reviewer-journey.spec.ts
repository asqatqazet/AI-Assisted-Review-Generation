import { expect, test } from "@playwright/test";

test("the reviewer entry is rendered with the Maue mobile layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/s/demo-tenant/demo-location");

  const heading = page.getByRole("heading", {
    name: "Write your review of Student Demo",
  });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("Student Demo");
  await expect(page.getByRole("banner")).toContainText("Review assistant");

  const rendering = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const title = getComputedStyle(document.querySelector("h1")!);
    const rating = document
      .querySelector<HTMLButtonElement>('button[aria-label="5, Very good"]')!
      .getBoundingClientRect();
    const start = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Start")!
      .getBoundingClientRect();

    return {
      bodyBackground: body.backgroundColor,
      bodyFont: body.fontFamily,
      titleColor: title.color,
      titleFontSize: title.fontSize,
      ratingHeight: rating.height,
      ratingWidth: rating.width,
      startHeight: start.height,
      viewportWidth: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
    };
  });

  expect(rendering).toMatchObject({
    bodyBackground: "rgb(255, 255, 255)",
    titleColor: "rgb(22, 24, 29)",
    titleFontSize: "40px",
    ratingHeight: 52,
    ratingWidth: 52,
    viewportWidth: 320,
    contentWidth: 320,
  });
  expect(rendering.bodyFont).toContain("Inter");
  expect(rendering.startHeight).toBeGreaterThanOrEqual(44);
});

test("a reviewer receives a grounded Draft from the local FakeProvider composition", async ({
  page,
}) => {
  await page.goto("/s/demo-tenant/demo-location");

  await expect(
    page.getByRole("heading", { name: "Write your review of Student Demo" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "5, Very good" }).click();
  await page.getByRole("button", { name: "Generate from my facts" }).click();
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page).toHaveURL(/\/review\/[A-Za-z0-9_-]+$/);
  await page.getByLabel("The team was attentive").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Concise review").check();
  await page.getByRole("button", { name: "Create my draft" }).click();

  await expect(page.getByRole("heading", { name: "Your review" })).toBeVisible();
  await expect(page.getByLabel("Review text")).toHaveValue(
    "The team was attentive.",
  );
});
