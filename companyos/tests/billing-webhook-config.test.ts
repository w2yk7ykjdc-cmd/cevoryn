import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const ORIGINAL_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

function restoreStripeEnv(): void {
  if (ORIGINAL_SECRET_KEY === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = ORIGINAL_SECRET_KEY;
  if (ORIGINAL_WEBHOOK_SECRET === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_WEBHOOK_SECRET;
}

/**
 * `@/env` validates eagerly at import time, so exercising different
 * STRIPE_* combinations requires mutating `process.env` *before* a fresh
 * module evaluation. `vi.resetModules()` plus a dynamic `import()` (never a
 * static one — those are hoisted above any code in this file, including a
 * `process.env` assignment) gets a clean `env`/`registry` pair per
 * scenario. This file deliberately imports nothing beyond
 * `@/server/billing/provider/registry` (which only pulls in `@/env` and the
 * `stripe` SDK, no Prisma/Redis), so resetting modules here can't leak
 * database/Redis connections the way re-importing the webhook route itself
 * would.
 */
describe("billing: webhook verification requires STRIPE_WEBHOOK_SECRET whenever STRIPE_SECRET_KEY is set", () => {
  afterEach(() => {
    restoreStripeEnv();
    vi.resetModules();
  });

  it("both configured -> billing configured and webhook verification configured", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fixture_full";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fixture_full";
    vi.resetModules();

    const registry = await import("@/server/billing/provider/registry");
    expect(registry.isBillingConfigured()).toBe(true);
    expect(registry.isWebhookVerificationConfigured()).toBe(true);
  });

  it("STRIPE_SECRET_KEY set without STRIPE_WEBHOOK_SECRET -> billing configured but webhook verification is NOT (the WP4 bug this closes)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fixture_partial";
    delete process.env.STRIPE_WEBHOOK_SECRET;
    vi.resetModules();

    const registry = await import("@/server/billing/provider/registry");
    expect(registry.isBillingConfigured()).toBe(true);
    expect(registry.isWebhookVerificationConfigured()).toBe(false);
  });

  it("neither configured (this project's default test environment) -> both false", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    vi.resetModules();

    const registry = await import("@/server/billing/provider/registry");
    expect(registry.isBillingConfigured()).toBe(false);
    expect(registry.isWebhookVerificationConfigured()).toBe(false);
  });

  it("the webhook route returns a distinct 500 configuration error (never a silent pass-through or a misleading 'invalid signature') when only STRIPE_SECRET_KEY is set", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fixture_partial_route";
    delete process.env.STRIPE_WEBHOOK_SECRET;
    vi.resetModules();

    const { POST } = await import("@/app/api/billing/webhook/route");
    const response = await POST(
      new Request("http://localhost/api/billing/webhook", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=irrelevant" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toMatch(/not configured/i);
  });
});
