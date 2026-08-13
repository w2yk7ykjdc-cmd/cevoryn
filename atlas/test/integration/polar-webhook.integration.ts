/**
 * Real Postgres + real Standard Webhooks integration suite for the Polar
 * webhook route (src/app/api/billing/polar/webhook/route.ts).
 *
 * Unlike test/polar-mapping.test.ts and test/polar-webhook-signature.test.ts
 * (pure unit tests, no I/O), this suite:
 *   - runs `prisma migrate deploy` against a real Postgres database
 *   - signs payloads with the real `standardwebhooks` Webhook class (the
 *     same mechanism Polar itself uses)
 *   - calls the actual exported `POST` route handler function directly
 *     (not mocked) with a real `Request` object
 *   - asserts on rows actually read back from Postgres afterward
 *
 * NEVER RUN THIS AGAINST PRODUCTION. It requires INTEGRATION_DATABASE_URL
 * to be set explicitly (never falls back to DATABASE_URL) and refuses to
 * run if that URL looks like a Supabase/production host. Run via:
 *
 *   INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cevoryn_integration_test \
 *     npm run test:integration
 *
 * This file intentionally does NOT end in `.test.ts` so the default
 * `npm test` (test/**\/*.test.ts) never picks it up - it must never run
 * without a database, and `npm test` must stay usable for contributors
 * who don't have Postgres available locally.
 *
 * "server-only" (imported transitively via the route -> error-reporting.ts)
 * throws under plain Node - it only resolves to its no-op empty.js under
 * the "react-server" export condition Next.js's real bundler uses. This
 * suite must be run with NODE_OPTIONS=--conditions=react-server (already
 * wired into the `test:integration` npm script) to load the route module
 * at all.
 *
 * Setup (env vars, `prisma migrate deploy`, dynamic imports of app code)
 * all happens inside `before()` rather than at module top level: this
 * project has no "type": "module" in package.json, so tsx/esbuild compile
 * test files to CJS, which doesn't support top-level `await` - and the
 * app modules must not be imported before DATABASE_URL/DIRECT_URL are set,
 * since src/lib/prisma.ts constructs `new PrismaClient()` at import time.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { Webhook } from "standardwebhooks";

// Type-only imports are erased at compile time (no runtime import), so
// these don't run into the module-load-order/top-level-await constraints
// documented below - they just give the dynamically-imported `let`
// bindings their real types instead of a hand-duplicated shape.
import type { POST as PostType } from "../../src/app/api/billing/polar/webhook/route";
import type { prisma as PrismaType } from "../../src/lib/prisma";
import type { getOrganizationSubscription as GetOrganizationSubscriptionType } from "../../src/server/services/billing.service";
import type { isSubscriptionActive as IsSubscriptionActiveType } from "../../src/features/billing/types";

const INTEGRATION_DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;

if (!INTEGRATION_DATABASE_URL) {
  console.error(
    "\nINTEGRATION_DATABASE_URL is not set.\n" +
      "This suite requires a real, disposable local Postgres database - it must\n" +
      "never point at production. Example:\n\n" +
      "  INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cevoryn_integration_test \\\n" +
      "    npm run test:integration\n"
  );
  process.exit(1);
}

if (/supabase\.co/i.test(INTEGRATION_DATABASE_URL)) {
  console.error(
    "INTEGRATION_DATABASE_URL looks like a Supabase (production-shaped) host - refusing to run."
  );
  process.exit(1);
}

const WEBHOOK_SECRET_RAW = "whsec_integration_test_secret_do_not_use_in_prod";
const TEST_RUN_ID = randomUUID().slice(0, 8);
const ORG_ID = `integration-test-org-${TEST_RUN_ID}`;
const PROFESSIONAL_PRODUCT_ID = "test-product-professional";
const CUSTOMER_ID = `integration-test-customer-${TEST_RUN_ID}`;
const SUBSCRIPTION_ID = `integration-test-subscription-${TEST_RUN_ID}`;
const usedEventIds: string[] = [];

// Assigned in before(); every test uses these instead of importing directly.
let POST: typeof PostType;
let prisma: typeof PrismaType;
let getOrganizationSubscription: typeof GetOrganizationSubscriptionType;
let isSubscriptionActive: typeof IsSubscriptionActiveType;

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL =
    process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;
  process.env.POLAR_WEBHOOK_SECRET = WEBHOOK_SECRET_RAW;
  process.env.POLAR_PRODUCT_STARTER = "test-product-starter";
  process.env.POLAR_PRODUCT_PROFESSIONAL = PROFESSIONAL_PRODUCT_ID;
  process.env.POLAR_PRODUCT_BUSINESS = "test-product-business";

  // Make sure the target database's schema is current before running -
  // exactly what production's build now also does (scripts/deploy-migrate.mjs).
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const routeModule =
    await import("../../src/app/api/billing/polar/webhook/route");
  POST = routeModule.POST;

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;

  const billingServiceModule =
    await import("../../src/server/services/billing.service");
  getOrganizationSubscription =
    billingServiceModule.getOrganizationSubscription;

  const billingTypesModule = await import("../../src/features/billing/types");
  isSubscriptionActive = billingTypesModule.isSubscriptionActive;

  await prisma.organization.create({
    data: {
      id: ORG_ID,
      name: "Integration Test Org",
      slug: `integration-test-org-${TEST_RUN_ID}`,
    },
  });
});

after(async () => {
  // Subscription rows cascade-delete with their organization
  // (onDelete: Cascade in schema.prisma), so deleting the org is enough
  // to clean that up. billing_webhook_events rows aren't linked by FK to
  // the organization, so they're deleted explicitly by event id.
  await prisma.organization.delete({ where: { id: ORG_ID } }).catch(() => {});
  if (usedEventIds.length > 0) {
    await prisma.billingWebhookEvent.deleteMany({
      where: { eventId: { in: usedEventIds } },
    });
  }
  await prisma.$disconnect();
});

function signPayload(msgId: string, timestamp: Date, payload: string): string {
  const base64Secret = Buffer.from(WEBHOOK_SECRET_RAW, "utf-8").toString(
    "base64"
  );
  const signer = new Webhook(base64Secret);
  return signer.sign(msgId, timestamp, payload);
}

interface SubscriptionEventOverrides {
  status?: string;
  cancel_at_period_end?: boolean;
  product_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

function buildSubscriptionEvent(
  type: string,
  overrides: SubscriptionEventOverrides = {}
) {
  return {
    type,
    timestamp: new Date().toISOString(),
    data: {
      id: SUBSCRIPTION_ID,
      created_at: new Date().toISOString(),
      modified_at: null,
      amount: 7900,
      currency: "usd",
      recurring_interval: "month",
      status: overrides.status ?? "active",
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000
      ).toISOString(),
      cancel_at_period_end: overrides.cancel_at_period_end ?? false,
      customer_id: CUSTOMER_ID,
      product_id:
        overrides.product_id === undefined
          ? PROFESSIONAL_PRODUCT_ID
          : overrides.product_id,
      metadata:
        overrides.metadata === undefined
          ? { organizationId: ORG_ID, plan: "PROFESSIONAL" }
          : overrides.metadata,
    },
  };
}

async function sendWebhook(
  event: unknown,
  eventIdOverride?: string
): Promise<{ status: number; body: unknown }> {
  const eventId = eventIdOverride ?? `evt-${TEST_RUN_ID}-${randomUUID()}`;
  usedEventIds.push(eventId);

  const payload = JSON.stringify(event);
  const timestamp = new Date();
  const signature = signPayload(eventId, timestamp, payload);

  const request = new Request("http://localhost/api/billing/polar/webhook", {
    method: "POST",
    headers: {
      "webhook-id": eventId,
      "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "webhook-signature": signature,
      "content-type": "application/json",
    },
    body: payload,
  });

  const response = await POST(request);
  const body = await response.json();
  return { status: response.status, body };
}

// ============================================================================
// Full realistic lifecycle for one organization, in order: this exercises
// the INSERT path once (subscription.created) and the ON CONFLICT DO
// UPDATE path for every event after, matching how a real subscription's
// events actually arrive over time for the same org.
// ============================================================================

test("subscription.created writes a new row via the real $executeRaw/transaction path", async () => {
  const event = buildSubscriptionEvent("subscription.created", {
    status: "active",
  });
  const { status, body } = await sendWebhook(event);

  assert.equal(status, 200);
  assert.deepEqual(body, { received: true, processed: true });

  const subscription = await getOrganizationSubscription(ORG_ID);
  assert.ok(subscription, "subscription row should exist after created event");
  assert.equal(subscription.plan, "PROFESSIONAL");
  assert.equal(subscription.subscriptionStatus, "ACTIVE");
  assert.equal(subscription.polarCustomerId, CUSTOMER_ID);
  assert.equal(subscription.polarSubscriptionId, SUBSCRIPTION_ID);
  assert.equal(subscription.polarProductId, PROFESSIONAL_PRODUCT_ID);
  assert.equal(subscription.stripeCustomerId, `polar:${CUSTOMER_ID}`);
});

test("subscription.active confirms ACTIVE status and active entitlement", async () => {
  const event = buildSubscriptionEvent("subscription.active", {
    status: "active",
  });
  const { status, body } = await sendWebhook(event);

  assert.equal(status, 200);
  assert.deepEqual(body, { received: true, processed: true });

  const subscription = await getOrganizationSubscription(ORG_ID);
  assert.ok(subscription);
  assert.equal(subscription.subscriptionStatus, "ACTIVE");
  assert.equal(
    isSubscriptionActive(subscription.subscriptionStatus),
    true,
    "ACTIVE must count as an active entitlement"
  );
});

test("subscription.updated applies a generic field change (new current_period_end)", async () => {
  const newPeriodEnd = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  const event = buildSubscriptionEvent("subscription.updated", {
    status: "active",
  });
  event.data.current_period_end = newPeriodEnd.toISOString();

  const { status } = await sendWebhook(event);
  assert.equal(status, 200);

  const subscription = await getOrganizationSubscription(ORG_ID);
  assert.ok(subscription);
  assert.equal(
    subscription.currentPeriodEnd?.toISOString(),
    newPeriodEnd.toISOString()
  );
});

test("subscription.canceled: cancelAtPeriodEnd becomes true, entitlement stays active (access until period end)", async () => {
  const event = buildSubscriptionEvent("subscription.canceled", {
    status: "active",
    cancel_at_period_end: true,
  });
  const { status } = await sendWebhook(event);
  assert.equal(status, 200);

  const subscription = await getOrganizationSubscription(ORG_ID);
  assert.ok(subscription);
  assert.equal(subscription.subscriptionStatus, "ACTIVE");
  assert.equal(subscription.cancelAtPeriodEnd, true);
  assert.equal(
    isSubscriptionActive(subscription.subscriptionStatus),
    true,
    "canceled-but-not-yet-ended subscriptions must keep access, per Polar's documented semantics"
  );
});

test("subscription.uncanceled: cancelAtPeriodEnd reverts to false", async () => {
  const event = buildSubscriptionEvent("subscription.uncanceled", {
    status: "active",
    cancel_at_period_end: false,
  });
  const { status } = await sendWebhook(event);
  assert.equal(status, 200);

  const subscription = await getOrganizationSubscription(ORG_ID);
  assert.ok(subscription);
  assert.equal(subscription.cancelAtPeriodEnd, false);
  assert.equal(isSubscriptionActive(subscription.subscriptionStatus), true);
});

test("subscription.past_due: status becomes PAST_DUE and entitlement is no longer active", async () => {
  const event = buildSubscriptionEvent("subscription.past_due", {
    status: "past_due",
  });
  const { status } = await sendWebhook(event);
  assert.equal(status, 200);

  const subscription = await getOrganizationSubscription(ORG_ID);
  assert.ok(subscription);
  assert.equal(subscription.subscriptionStatus, "PAST_DUE");
  assert.equal(
    isSubscriptionActive(subscription.subscriptionStatus),
    false,
    "PAST_DUE must not count as an active entitlement"
  );
});

test("subscription.revoked: terminal state (status becomes canceled), entitlement is not active", async () => {
  // Per @polar-sh/sdk's WebhookSubscriptionRevokedPayload doc comment:
  // "Happens when the subscription is canceled or payment retries are
  // exhausted (status becomes `unpaid`)." - this is the "canceled" branch.
  const event = buildSubscriptionEvent("subscription.revoked", {
    status: "canceled",
  });
  const { status } = await sendWebhook(event);
  assert.equal(status, 200);

  const subscription = await getOrganizationSubscription(ORG_ID);
  assert.ok(subscription);
  assert.equal(subscription.subscriptionStatus, "CANCELED");
  assert.equal(
    isSubscriptionActive(subscription.subscriptionStatus),
    false,
    "a revoked subscription must never leave entitlement active"
  );
});

test("subscription.revoked via exhausted payment retries: status becomes unpaid, entitlement is not active", async () => {
  const event = buildSubscriptionEvent("subscription.revoked", {
    status: "unpaid",
  });
  const { status } = await sendWebhook(event);
  assert.equal(status, 200);

  const subscription = await getOrganizationSubscription(ORG_ID);
  assert.ok(subscription);
  assert.equal(subscription.subscriptionStatus, "UNPAID");
  assert.equal(isSubscriptionActive(subscription.subscriptionStatus), false);
});

// ============================================================================
// Idempotency: billing_webhook_events must block a true duplicate delivery
// (same webhook-id) from writing/upserting a second time.
// ============================================================================

test("idempotency: redelivering the exact same event id does not reprocess or duplicate", async () => {
  const eventId = `evt-${TEST_RUN_ID}-idempotency-check`;
  const event = buildSubscriptionEvent("subscription.active", {
    status: "active",
  });

  const first = await sendWebhook(event, eventId);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { received: true, processed: true });

  const subscriptionAfterFirst = await getOrganizationSubscription(ORG_ID);
  const updatedAtAfterFirst = subscriptionAfterFirst?.updatedAt.getTime();

  const second = await sendWebhook(event, eventId);
  assert.equal(second.status, 200);
  assert.deepEqual(
    second.body,
    { received: true, processed: false },
    "a redelivered event with the same webhook-id must be recognized as already claimed"
  );

  const subscriptionAfterSecond = await getOrganizationSubscription(ORG_ID);
  assert.equal(
    subscriptionAfterSecond?.updatedAt.getTime(),
    updatedAtAfterFirst,
    "the subscription row must not be touched again by the duplicate delivery"
  );

  const eventRows = await prisma.billingWebhookEvent.findMany({
    where: { eventId },
  });
  assert.equal(
    eventRows.length,
    1,
    "exactly one billing_webhook_events row must exist for this event id, not two"
  );
});

// ============================================================================
// Failure paths - these must NOT write anything to the database.
// ============================================================================

test("an invalid signature is rejected with 401 and writes nothing", async () => {
  const event = buildSubscriptionEvent("subscription.active");
  const payload = JSON.stringify(event);
  const eventId = `evt-${TEST_RUN_ID}-bad-signature`;
  usedEventIds.push(eventId);

  const request = new Request("http://localhost/api/billing/polar/webhook", {
    method: "POST",
    headers: {
      "webhook-id": eventId,
      "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
      "webhook-signature": "v1,not-a-real-signature",
      "content-type": "application/json",
    },
    body: payload,
  });

  const response = await POST(request);
  assert.equal(response.status, 401);

  const eventRows = await prisma.billingWebhookEvent.findMany({
    where: { eventId },
  });
  assert.equal(eventRows.length, 0);
});

test("an unknown product id is rejected with 500 and writes nothing to subscriptions", async () => {
  const event = buildSubscriptionEvent("subscription.active", {
    product_id: "product-that-was-never-configured",
  });
  const { status } = await sendWebhook(event);
  assert.equal(status, 500);

  // The org's subscription row must still reflect the last *successful*
  // event from the lifecycle tests above, not this rejected one.
  const subscription = await getOrganizationSubscription(ORG_ID);
  assert.notEqual(
    subscription?.polarProductId,
    "product-that-was-never-configured"
  );
});

test("a subscription event missing CEVORYN's organizationId metadata is rejected with 500", async () => {
  const event = buildSubscriptionEvent("subscription.active", {
    metadata: {},
  });
  const { status } = await sendWebhook(event);
  assert.equal(status, 500);
});

test("an event type this integration doesn't subscribe to is acknowledged (200) without being processed", async () => {
  const event = {
    type: "checkout.updated",
    timestamp: new Date().toISOString(),
    data: { id: "some-checkout-id" },
  };
  const { status, body } = await sendWebhook(event);
  assert.equal(status, 200);
  assert.deepEqual(body, { received: true });
});
