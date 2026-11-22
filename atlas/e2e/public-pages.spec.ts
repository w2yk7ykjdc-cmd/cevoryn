import { expect, test } from "@playwright/test";

test("signup page exposes the expected account creation fields", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.locator("#email")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  await expect(page.locator("#confirmPassword")).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});

test("login page exposes the expected sign-in fields", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("#email")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  const passwordForm = page
    .locator("form")
    .filter({ has: page.locator("#password") });
  await expect(passwordForm.locator('button[type="submit"]')).toBeVisible();
});

test("terms page no longer claims private-beta status", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.locator("body")).not.toContainText("private beta");
  await expect(page.locator("body")).not.toContainText("beta program");
});
