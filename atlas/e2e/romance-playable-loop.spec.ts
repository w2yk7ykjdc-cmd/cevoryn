import { expect, test } from "@playwright/test";

test("unauthenticated visitors are redirected from Romance to login", async ({ page }) => {
  await page.goto("/romance");
  await expect(page).toHaveURL(/\/login\?next=%2Fromance/);
  await expect(page.locator("#email")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
});

test("signup page exposes the expected account creation fields", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.locator("#email")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  await expect(page.locator("#confirmPassword")).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});
