import { expect, test } from "@playwright/test";

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
