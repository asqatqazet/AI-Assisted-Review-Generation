import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

test("the browser root explains how to enter without exposing a Tenant", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Review assistant" }),
  ).toBeVisible();
  await expect(page.getByText("Open the review link you were given")).toBeVisible();
});

test("the reviewer entry is rendered with the Maue mobile layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/s/speicher-neun/hafencity");

  const heading = page.getByRole("heading", {
    name: "Bewerten Sie Ihren Besuch bei Speicher Neun",
  });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("Speicher Neun");
  await expect(page.getByRole("banner")).toContainText("Offener Besuch");

  const rendering = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const title = getComputedStyle(document.querySelector("h1")!);
    const rating = document
      .querySelector<HTMLButtonElement>('button[aria-label="5, Sehr gut"]')!
      .getBoundingClientRect();
    const start = Array.from(document.querySelectorAll("button"))
      .find(
        (button) =>
          button.textContent?.trim() === "Auswählen, was erwähnt wird",
      )!
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
  await page.goto("/s/speicher-neun/hafencity");
  await page.getByRole("button", { name: "5, Sehr gut" }).click();
  await page
    .getByRole("button", { name: "Auswählen, was erwähnt wird" })
    .click();

  await expect(page).toHaveURL(/\/review\/[A-Za-z0-9_-]+$/);
  const factChoice = page.getByLabel("Frischer Fisch");
  const secondFactChoice = page.getByLabel("Gut gewürzt");
  await expect(factChoice).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("Speicher Neun");

  const phoneRendering = await page.evaluate(() => {
    const fact = document
      .querySelector<HTMLInputElement>(
        'input[value]',
      )!
      .closest("label")!
      .getBoundingClientRect();
    const continueButton = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Format wählen")!
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

  await factChoice.press("Space");
  await secondFactChoice.press("Space");
  await expect(factChoice).toBeChecked();
  await expect(secondFactChoice).toBeChecked();
  await page.getByRole("button", { name: "Format wählen" }).click();
  await page.setViewportSize({ width: 768, height: 900 });

  const formatChoice = page.getByLabel("Kurzer Text");
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

  await formatChoice.press("Space");
  await expect(formatChoice).toBeChecked();
  await page.getByRole("button", { name: "Entwurf schreiben" }).click();
  const reviewText = page.getByLabel("Ihr Entwurf — frei bearbeitbar");
  await expect(reviewText).toHaveValue("Frischer Fisch. Gut gewürzt.");
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

test("the operator console requires an authenticated BFF session", async ({
  page,
}) => {
  await page.goto("/console");

  await expect(
    page.getByRole("heading", { name: "Sign in to Console" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/auth/login?returnTo=%2Fconsole",
  );
  await expect(page.getByRole("navigation", { name: "Console" })).toHaveCount(
    0,
  );
});

test("the operator console renders only its BFF-granted 1024px scope", async ({
  page,
}) => {
  await page.route("**/api/v1/console/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: "authorized",
        operator: {
          id: "00000000-0000-4000-8000-000000000301",
          email: "owner@example.com",
        },
        platformGrants: [
          {
            roleKey: "platform_admin",
            capabilities: ["console:read", "platform:admin"],
          },
        ],
        tenantGrants: [
          {
            tenantId: "00000000-0000-4000-8000-000000000101",
            tenantSlug: "speicher-neun",
            tenantName: "Speicher Neun",
            roleKey: "tenant_admin",
            capabilities: ["console:read", "tenant:configure"],
            locations: [
              {
                locationId: "00000000-0000-4000-8000-000000000102",
                locationSlug: "hafencity",
                locationName: "Speicher Neun · HafenCity",
                status: "active",
              },
            ],
          },
        ],
      }),
    });
  });
  // Role, Tenants and capabilities arrive as one authorized projection; the
  // browser derives no scope of its own.
  await page.route("**/api/v1/console/views/bootstrap*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        view: "bootstrap",
        data: {
          user: {
            id: "00000000-0000-4000-8000-000000000301",
            displayName: "owner@example.com",
          },
          role: "platform_admin",
          tenants: [
            {
              id: "00000000-0000-4000-8000-000000000101",
              slug: "speicher-neun",
              name: "Speicher Neun",
              locations: [
                {
                  id: "00000000-0000-4000-8000-000000000102",
                  slug: "hafencity",
                  name: "Speicher Neun · HafenCity",
                  active: true,
                },
              ],
            },
          ],
          activeContext: { tenantId: null, locationId: null },
          capabilities: {
            canAccessPlatform: true,
            canSwitchTenant: true,
            canManageLocations: true,
            canManageConfiguration: true,
            canViewAnalytics: true,
            canManageAiOperations: false,
            canManageProviders: true,
          },
        },
      }),
    });
  });
  await page.route("**/api/v1/console/views/overview*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        view: "overview",
        data: {
          scope: { type: "platform" },
          window: {
            from: "2026-07-19T00:00:00.000Z",
            to: "2026-08-18T00:00:00.000Z",
          },
          metrics: {
            generations: 0,
            accepted: 0,
            acceptanceRate: 0,
            totalCost: { amountMicros: 0, currency: "EUR" },
            costPerAccepted: null,
          },
          byAction: [],
          byLocation: [],
          byTenant: [],
          experiment: null,
          providerHealth: [],
          alerts: [],
        },
      }),
    });
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/console");

  await expect(
    page.getByRole("heading", { name: "Overview" }),
  ).toBeVisible();
  const scopeBar = page.getByRole("banner");
  await expect(scopeBar).toContainText("Platform");
  await expect(scopeBar).toContainText("owner@example.com");
  await expect(page.getByRole("navigation", { name: "Console" })).toBeVisible();

  // Only the granted Tenant is offered, and its Locations become selectable
  // only once that Tenant is the current scope.
  const account = page.getByLabel("Account");
  await expect(account.locator("option")).toHaveText([
    "Platform",
    "Speicher Neun",
  ]);
  await account.selectOption("00000000-0000-4000-8000-000000000101");
  await expect(page.getByLabel("Location").locator("option")).toHaveText([
    "All locations",
    "Speicher Neun · HafenCity",
  ]);

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
  await page.goto("/s/speicher-neun/hafencity");
  await page.getByRole("button", { name: "5, Sehr gut" }).click();

  const startRequestPromise = page.waitForRequest((request) => {
    const path = new URL(request.url()).pathname;
    return (
      request.method() === "POST" &&
      /^\/api\/v1\/entry-challenges\/[A-Za-z0-9_-]+\/start$/.test(path)
    );
  });
  await page
    .getByRole("button", { name: "Auswählen, was erwähnt wird" })
    .click();
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
  await page.goto("/s/speicher-neun/hafencity");

  await expect(
    page.getByRole("heading", {
      name: "Bewerten Sie Ihren Besuch bei Speicher Neun",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "5, Sehr gut" }).click();
  await page
    .getByRole("button", { name: "Auswählen, was erwähnt wird" })
    .click();

  await expect(page).toHaveURL(/\/review\/[A-Za-z0-9_-]+$/);
  const factChoice = page.getByLabel("Frischer Fisch");
  const secondFactChoice = page.getByLabel("Gut gewürzt");
  await factChoice.press("Space");
  await secondFactChoice.press("Space");
  await expect(factChoice).toBeChecked();
  await expect(secondFactChoice).toBeChecked();
  await page.getByRole("button", { name: "Format wählen" }).click();
  const formatChoice = page.getByLabel("Kurzer Text");
  await formatChoice.press("Space");
  await expect(formatChoice).toBeChecked();
  await page.getByRole("button", { name: "Entwurf schreiben" }).click();

  await expect(page.getByRole("heading", { name: "Hier ist er" })).toBeVisible();
  await expect(page.getByLabel("Ihr Entwurf — frei bearbeitbar")).toHaveValue(
    "Frischer Fisch. Gut gewürzt.",
  );
});
