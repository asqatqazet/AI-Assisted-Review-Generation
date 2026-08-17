import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

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

test("the review stages keep the responsive Maue layout", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto("/s/demo-tenant/demo-location");
  await page.getByRole("button", { name: "5, Very good" }).click();
  await page.getByRole("button", { name: "Generate from my facts" }).click();
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page).toHaveURL(/\/review\/[A-Za-z0-9_-]+$/);
  const factChoice = page.getByLabel("The team was attentive");
  await expect(factChoice).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("Student Demo");

  const phoneRendering = await page.evaluate(() => {
    const fact = document
      .querySelector<HTMLInputElement>(
        'input[aria-label="The team was attentive"], input[value]',
      )!
      .closest("label")!
      .getBoundingClientRect();
    const continueButton = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Continue")!
      .getBoundingClientRect();
    return {
      contentWidth: document.documentElement.scrollWidth,
      factHeight: fact.height,
      continueHeight: continueButton.height,
    };
  });
  expect(phoneRendering).toMatchObject({ contentWidth: 375 });
  expect(phoneRendering.factHeight).toBeGreaterThanOrEqual(44);
  expect(phoneRendering.continueHeight).toBeGreaterThanOrEqual(44);

  await factChoice.check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.setViewportSize({ width: 768, height: 900 });

  const formatChoice = page.getByLabel("Concise review");
  await expect(formatChoice).toBeVisible();
  const tabletRendering = await page.evaluate(() => {
    const main = document.querySelector("main")!.getBoundingClientRect();
    const choice = document
      .querySelector<HTMLInputElement>('input[type="radio"]')!
      .closest("label")!
      .getBoundingClientRect();
    return { mainWidth: main.width, choiceHeight: choice.height };
  });
  expect(tabletRendering.mainWidth).toBe(560);
  expect(tabletRendering.choiceHeight).toBeGreaterThanOrEqual(72);

  await formatChoice.check();
  await page.getByRole("button", { name: "Create my draft" }).click();
  const reviewText = page.getByLabel("Review text");
  await expect(reviewText).toHaveValue("The team was attentive.");
  const resultRendering = await reviewText.evaluate((textarea) => {
    const style = getComputedStyle(textarea);
    const rect = textarea.getBoundingClientRect();
    return {
      borderColor: style.borderColor,
      minHeight: rect.height,
      width: rect.width,
    };
  });
  expect(resultRendering).toMatchObject({
    borderColor: "rgb(217, 217, 221)",
  });
  expect(resultRendering.minHeight).toBeGreaterThanOrEqual(120);
  expect(resultRendering.width).toBeGreaterThanOrEqual(470);
});

test("the operator console keeps its 1024px working layout", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/console");

  await expect(
    page.getByRole("heading", { name: "Operator console" }),
  ).toBeVisible();
  await expect(page.getByRole("banner")).toContainText(
    "Platform › Tenant › Location",
  );
  await expect(page.getByRole("navigation", { name: "Console" })).toBeVisible();

  const rendering = await page.evaluate(() => {
    const navigation = document
      .querySelector('nav[aria-label="Console"]')!
      .getBoundingClientRect();
    const main = getComputedStyle(document.querySelector("main")!);
    return {
      navigationWidth: navigation.width,
      mainPaddingLeft: main.paddingLeft,
      contentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });

  expect(rendering).toEqual({
    navigationWidth: 224,
    mainPaddingLeft: "32px",
    contentWidth: 1024,
    viewportWidth: 1024,
  });
});

test("the browser binds the exact Start payload to its SHA-256 header", async ({
  page,
}) => {
  await page.goto("/s/demo-tenant/demo-location");
  await page.getByRole("button", { name: "5, Very good" }).click();
  await page.getByRole("button", { name: "Generate from my facts" }).click();

  const startRequestPromise = page.waitForRequest((request) => {
    const path = new URL(request.url()).pathname;
    return (
      request.method() === "POST" &&
      /^\/api\/v1\/entry-challenges\/[A-Za-z0-9_-]+\/start$/.test(path)
    );
  });
  await page.getByRole("button", { name: "Start" }).click();
  const startRequest = await startRequestPromise;
  const payload = startRequest.postData();

  expect(payload).not.toBeNull();
  const fields = new URLSearchParams(payload!);
  expect(Object.fromEntries(fields.entries())).toMatchObject({
    rating: "5",
    action: "generate",
  });
  expect(fields.get("csrfToken")).toMatch(/^\S{32,}$/);
  expect(startRequest.headers()["content-type"]).toBe(
    "application/x-www-form-urlencoded;charset=UTF-8",
  );
  expect(startRequest.headers()["x-amz-content-sha256"]).toBe(
    createHash("sha256").update(payload!).digest("hex"),
  );
  await expect(page).toHaveURL(/\/review\/[A-Za-z0-9_-]+$/);
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
