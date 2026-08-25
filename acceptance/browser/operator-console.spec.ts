import { expect, test, type Page } from "@playwright/test";

const TENANT_ID = "00000000-0000-4000-8000-000000000101";
const LOCATION_ID = "00000000-0000-4000-8000-000000000102";
const OTHER_LOCATION_ID = "00000000-0000-4000-8000-000000000402";
const localOnly = process.env["REVIEW_BROWSER_BASE_URL"] === undefined;
test.skip(!localOnly, "these checks prove the local-only composition");

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const signIn = async (
  page: Page,
  operator: "platform" | "tenant",
): Promise<void> => {
  const credential = requiredEnv(
    operator === "platform"
      ? "REVIEW_LOCAL_PLATFORM_CREDENTIAL"
      : "REVIEW_LOCAL_TENANT_CREDENTIAL",
  );
  const returnTo = `/console?localCredential=${credential}`;
  await page.goto(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  await expect(page).toHaveURL(/\/console$/u);
};

const browserGet = async (
  page: Page,
  path: string,
): Promise<{ readonly status: number; readonly body: unknown }> =>
  await page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath, { credentials: "same-origin" });
    return { status: response.status, body: await response.json() };
  }, path);

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage({ baseURL: "http://127.0.0.1:5173" });
  try {
    await page.goto("/s/speicher-neun/hafencity");
    await page.getByRole("button", { name: "5, Sehr gut" }).click();
    await page
      .getByRole("button", { name: "Auswählen, was erwähnt wird" })
      .click();
    await expect(page).toHaveURL(/\/review\/[A-Za-z0-9_-]+$/u);
    await page.getByLabel("Frischer Fisch").press("Space");
    await page.getByLabel("Gut gewürzt").press("Space");
    await page.getByRole("button", { name: "Format wählen" }).click();
    await page.getByLabel("Kurzer Text").press("Space");
    await page.getByRole("button", { name: "Entwurf schreiben" }).click();
    await expect(page.getByRole("heading", { name: "Hier ist er" })).toBeVisible();
  } finally {
    await page.close();
  }
});

test("each local deployable connects as its exact PostgreSQL service role", async ({
  request,
}) => {
  const responses = await Promise.all([
    request.get("http://127.0.0.1:3001/__local/current-user"),
    request.get("http://127.0.0.1:3003/__local/current-user"),
    request.get("http://127.0.0.1:3002/__local/current-user"),
  ]);
  const roles = await Promise.all(
    responses.map(async (response) => {
      expect(response.ok()).toBe(true);
      return (await response.json()) as { readonly current_user: string };
    }),
  );
  expect(roles).toEqual([
    { current_user: "context_runtime_svc" },
    { current_user: "console_control_svc" },
    { current_user: "generation_svc" },
  ]);
});

test("a tenant-only local Operator signs in through the BFF without Platform navigation", async ({
  page,
}) => {
  await signIn(page, "tenant");

  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Release local-e2e")).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Console" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Platform" })).toHaveCount(0);
  await expect(page.getByLabel("Account")).toHaveCount(0);
  await expect(page.getByRole("banner")).toContainText(/Tenant\s*Speicher Neun/u);
});

test("crossing a Tenant with another Tenant's Location is one generic 404", async ({
  page,
}) => {
  await signIn(page, "platform");

  const response = await browserGet(
    page,
    `/api/v1/console/views/overview?tenantId=${TENANT_ID}&locationId=${OTHER_LOCATION_ID}`,
  );

  expect(response.status).toBe(404);
  expect(response.body).toMatchObject({
    code: "CONSOLE_NOT_FOUND",
    message: "This resource is unavailable.",
    retryable: false,
  });
});

test("Overview is read through the real Context and Generation composition", async ({
  page,
}) => {
  await signIn(page, "tenant");

  const response = await browserGet(
    page,
    `/api/v1/console/views/overview?tenantId=${TENANT_ID}&locationId=${LOCATION_ID}`,
  );

  expect(response.status).toBe(200);
  const projection = response.body as {
    readonly view: string;
    readonly data: {
      readonly scope: { readonly type: string };
      readonly metrics: { readonly generations: number };
    };
  };
  expect(projection.view).toBe("overview");
  expect(projection.data.scope.type).toBe("location");
  expect(projection.data.metrics.generations).toBeGreaterThan(0);
});

test("a provider revocation failure still removes the local Operator session", async ({
  page,
}) => {
  await signIn(page, "tenant");

  const logout = await page.evaluate(async () => {
    const response = await fetch("/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "",
    });
    return { status: response.status, body: await response.json() };
  });
  expect(logout.status).toBe(503);

  const session = await browserGet(page, "/api/v1/console/session");
  expect(session.status).toBe(401);
});
