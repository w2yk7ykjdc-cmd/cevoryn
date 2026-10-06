import { expect, test } from "@playwright/test";

/**
 * The brief's required real-browser E2E flow: signup/login -> age
 * verification -> story library -> story selection -> character
 * creation -> start session -> submit free-form input -> receive a
 * validated scene -> leave -> return -> prior state is present ->
 * a second user cannot access the first user's session.
 *
 * HONEST LIMITATION (documented, not hidden): this sandbox has no real
 * Supabase project (NEXT_PUBLIC_SUPABASE_URL points at a placeholder
 * host, confirmed earlier this session via a live signup attempt). Every
 * Romance route requires requireUser()/getUser(), which performs a real
 * network round-trip to Supabase Auth - there is no way to pass that
 * boundary in this environment without inventing a parallel auth system,
 * which the product contract explicitly forbids. This spec documents
 * exactly where the flow is blocked (signup never completes) rather than
 * faking a pass past it. Everything downstream of login IS proven
 * end-to-end - at the service layer, not through a browser - by
 * test/integration/romance-playable-loop.integration.ts.
 */
test("romance routes are middleware-protected and the signup flow is reachable (blocked at the real Supabase boundary in this sandbox - see comment above)", async ({
  page,
}) => {
  await page.goto("/romance");
  await expect(page).toHaveURL(/\/login\?next=%2Fromance/);

  await page.goto("/signup");
  const email = `e2e-romance-${Date.now()}@example.com`;
  await page.fill("#email", email);
  await page.fill("#password", "TestPassword123!");
  await page.fill("#confirmPassword", "TestPassword123!");
  await page.click('button[type="submit"]');

  // This is the real, observed outcome in this sandbox: Supabase Auth is
  // not reachable (placeholder project), so signup never succeeds and the
  // flow cannot proceed past this point. Asserting it explicitly here
  // (rather than silently stopping) makes the blocker a verifiable test
  // result, not an assumption.
  await expect(page.getByText(/authentication failed|error/i).first()).toBeVisible({
    timeout: 10_000,
  });
});
