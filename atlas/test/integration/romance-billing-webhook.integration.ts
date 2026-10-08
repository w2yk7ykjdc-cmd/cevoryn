/**
 * Real Postgres + real Standard Webhooks integration suite for the
 * Romance branch of the shared Polar webhook route
 * (src/app/api/billing/polar/webhook/route.ts -> applyPolarRomanceSubscriptionEvent).
 * Mirrors test/integration/polar-webhook.integration.ts's approach and
 * safety rules exactly (see that file's header comment for the full
 * rationale) - this suite is the Romance-specific counterpart, proving
 * the metadata-based routing (romancePlayerId vs organizationId) sends
 * events to the right table without ever touching the B2B path.
 *
 * NEVER RUN THIS AGAINST PRODUCTION. Requires INTEGRATION_DATABASE_URL,
 * refuses a Supabase-shaped host, run via `npm run test:integration`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { Webhook } from "standardwebhooks";

import type { POST as PostType } from "../../src/app/api/billing/polar/webhook/route";
import type { isRomancePremiumActive as IsRomancePremiumActiveType } from "../../src/features/romance/billing/entitlement-math";
import type { getRomanceSubscription as GetRomanceSubscriptionType } from "../../src/features/romance/billing/romance-subscription.service";
import type { prisma as PrismaType } from "../../src/lib/prisma";

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
const ROMANCE_PREMIUM_PRODUCT_ID = "test-product-romance-premium";
const CUSTOMER_ID = `integration-test-romance-customer-${TEST_RUN_ID}`;
const SUBSCRIPTION_ID = `integration-test-romance-subscription-${TEST_RUN_ID}`;
const usedEventIds: string[] = [];

let POST: typeof PostType;
let prisma: typeof PrismaType;
let getRomanceSubscription: typeof GetRomanceSubscriptionType;
let isRomancePremiumActive: typeof IsRomancePremiumActiveType;

let playerId: string;

before(async () => {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
  process.env.DIRECT_URL = process.env.INTEGRATION_DIRECT_URL ?? INTEGRATION_DATABASE_URL;
  process.env.POLAR_WEBHOOK_SECRET = WEBHOOK_SECRET_RAW;
  process.env.POLAR_PRODUCT_ROMANCE_PREMIUM = ROMANCE_PREMIUM_PRODUCT_ID;
  // Deliberately NOT set, so this suite also proves the Romance path
  // never needs the B2B product env vars to do its own job correctly.
  delete process.env.POLAR_PRODUCT_STARTER;
  delete process.env.POLAR_PRODUCT_PROFESSIONAL;
  delete process.env.POLAR_PRODUCT_BUSINESS;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const routeModule = await import("../../src/app/api/billing/polar/webhook/route");
  POST = routeModule.POST;

  const prismaModule = await import("../../src/lib/prisma");
  prisma = prismaModule.prisma;

  const subscriptionServiceModule = await import(
    "../../src/features/romance/billing/romance-subscription.service"
  );
  getRomanceSubscription = subscriptionServiceModule.getRomanceSubscription;

  const entitlementMathModule = await import(
    "../../src/features/romance/billing/entitlement-math"
  );
  isRomancePremiumActive = entitlementMathModule.isRomancePremiumActive;

  const player = await prisma.romancePlayer.create({
    data: { userId: `user-${TEST_RUN_ID}`, displayName: "Integration Test Player" },
  });
  playerId = player.id;
});

after(async () => {
  if (usedEventIds.length > 0) {
    try {
      await prisma.billingWebhookEvent.deleteMany({
        where: { eventId: { in: usedEventIds } },
      });
    } catch (error) {
      console.error("[test cleanup] Failed to delete billing_webhook_events test rows:", error);
    }
  }

  // RomanceSubscription cascade-deletes with its player (onDelete: Cascade).
  try {
    await prisma.romancePlayer.delete({ where: { id: playerId } });
  } catch (error) {
    console.error(`[test cleanup] Failed to delete test player ${playerId}:`, error);
  }

  await prisma.$disconnect();
});

function signPayload(msgId: string, timestamp: Date, payload: string): string {
  const base64Secret = Buffer.from(WEBHOOK_SECRET_RAW, "utf-8").toString("base64");
  const signer = new Webhook(base64Secret);
  return signer.sign(msgId, timestamp, payload);
}

interface SubscriptionEventOverrides {
  status?: string;
  product_id?: string | null;
  metadata?: Record<string, unknown> | null;
  current_period_end?: string;
  timestamp?: string;
}

function buildRomanceSubscriptionEvent(
  type: string,
  overrides: SubscriptionEventOverrides = {}
) {
  return {
    type,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    data: {
      id: SUBSCRIPTION_ID,
      status: overrides.status ?? "active",
      current_period_start: new Date().toISOString(),
      current_period_end:
        overrides.current_period_end ??
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      cancel_at_period_end: false,
      customer_id: CUSTOMER_ID,
      product_id:
        overrides.product_id === undefined ? ROMANCE_PREMIUM_PRODUCT_ID : overrides.product_id,
      metadata:
        overrides.metadata === undefined ? { romancePlayerId: playerId } : overrides.metadata,
    },
  };
}

async function sendWebhook(
  event: unknown,
  eventIdOverride?: string
): Promise<{ status: number; body: unknown }> {
  const eventId = eventIdOverride ?? `evt-romance-${TEST_RUN_ID}-${randomUUID()}`;
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

test("subscription.created writes a new RomanceSubscription row, routed by romancePlayerId metadata (not organizationId)", async () => {
  const event = buildRomanceSubscriptionEvent("subscription.created", { status: "active" });
  const { status, body } = await sendWebhook(event);

  assert.equal(status, 200);
  assert.deepEqual(body, { received: true, processed: true });

  const subscription = await getRomanceSubscription(playerId);
  assert.ok(subscription, "a RomanceSubscription row should exist after created event");
  assert.equal(subscription.plan, "PREMIUM");
  assert.equal(subscription.status, "ACTIVE");
  assert.equal(subscription.provider, "polar");
  assert.equal(subscription.providerCustomerId, CUSTOMER_ID);
  assert.equal(isRomancePremiumActive(subscription), true);
});

test("subscription.updated applies a new current_period_end", async () => {
  const newPeriodEnd = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  const event = buildRomanceSubscriptionEvent("subscription.updated", {
    status: "active",
    current_period_end: newPeriodEnd.toISOString(),
  });
  const { status } = await sendWebhook(event);
  assert.equal(status, 200);

  const subscription = await getRomanceSubscription(playerId);
  assert.ok(subscription);
  assert.equal(subscription.currentPeriodEnd?.toISOString(), newPeriodEnd.toISOString());
});

test("subscription.canceled while still within the paid period keeps the player entitled", async () => {
  // Polar's documented semantics: cancel_at_period_end=true but status
  // stays "active" until the period actually ends - RomanceSubscription
  // has no cancelAtPeriodEnd column (simpler model than the B2B table),
  // so the only observable effect here is that status/plan are unchanged.
  const event = buildRomanceSubscriptionEvent("subscription.canceled", { status: "active" });
  const { status } = await sendWebhook(event);
  assert.equal(status, 200);

  const subscription = await getRomanceSubscription(playerId);
  assert.ok(subscription);
  assert.equal(subscription.status, "ACTIVE");
  assert.equal(isRomancePremiumActive(subscription), true);
});

test("subscription.revoked (terminal cancellation) ends entitlement immediately", async () => {
  const event = buildRomanceSubscriptionEvent("subscription.revoked", { status: "canceled" });
  const { status } = await sendWebhook(event);
  assert.equal(status, 200);

  const subscription = await getRomanceSubscription(playerId);
  assert.ok(subscription);
  assert.equal(subscription.status, "CANCELED");
  assert.equal(isRomancePremiumActive(subscription), false);
});

test("subscription.past_due ends entitlement (fails closed on payment trouble)", async () => {
  const event = buildRomanceSubscriptionEvent("subscription.past_due", { status: "past_due" });
  const { status } = await sendWebhook(event);
  assert.equal(status, 200);

  const subscription = await getRomanceSubscription(playerId);
  assert.ok(subscription);
  assert.equal(subscription.status, "EXPIRED");
  assert.equal(isRomancePremiumActive(subscription), false);
});

test("subscription.active re-confirms entitlement after a prior past_due/revoked event", async () => {
  const event = buildRomanceSubscriptionEvent("subscription.active", { status: "active" });
  const { status } = await sendWebhook(event);
  assert.equal(status, 200);

  const subscription = await getRomanceSubscription(playerId);
  assert.ok(subscription);
  assert.equal(subscription.status, "ACTIVE");
  assert.equal(isRomancePremiumActive(subscription), true);
});

test("idempotency: redelivering the exact same event id does not reprocess or duplicate", async () => {
  const eventId = `evt-romance-${TEST_RUN_ID}-idempotency-check`;
  const event = buildRomanceSubscriptionEvent("subscription.active", { status: "active" });

  const first = await sendWebhook(event, eventId);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { received: true, processed: true });

  const subscriptionAfterFirst = await getRomanceSubscription(playerId);
  const updatedAtAfterFirst = subscriptionAfterFirst?.updatedAt.getTime();

  const second = await sendWebhook(event, eventId);
  assert.equal(second.status, 200);
  assert.deepEqual(
    second.body,
    { received: true, processed: false },
    "a redelivered event with the same webhook-id must be recognized as already claimed"
  );

  const subscriptionAfterSecond = await getRomanceSubscription(playerId);
  assert.equal(
    subscriptionAfterSecond?.updatedAt.getTime(),
    updatedAtAfterFirst,
    "the RomanceSubscription row must not be touched again by the duplicate delivery"
  );

  const eventRows = await prisma.billingWebhookEvent.findMany({ where: { eventId } });
  assert.equal(eventRows.length, 1);
});

test("out-of-order webhook delivery: a delayed/retried OLDER event never overwrites state a NEWER event already applied", async () => {
  const now = Date.now();
  const olderTimestamp = new Date(now - 60 * 60 * 1000).toISOString();
  const newerTimestamp = new Date(now).toISOString();

  const newerResult = await sendWebhook(
    buildRomanceSubscriptionEvent("subscription.active", {
      status: "active",
      timestamp: newerTimestamp,
    })
  );
  assert.equal(newerResult.status, 200);

  const afterNewer = await getRomanceSubscription(playerId);
  assert.equal(afterNewer?.status, "ACTIVE");

  const olderResult = await sendWebhook(
    buildRomanceSubscriptionEvent("subscription.past_due", {
      status: "past_due",
      timestamp: olderTimestamp,
    })
  );
  assert.equal(olderResult.status, 200);
  assert.deepEqual(
    olderResult.body,
    { received: true, processed: true },
    "the older event is still claimed (new event id) - only the DB write is rejected"
  );

  const afterOlder = await getRomanceSubscription(playerId);
  assert.equal(
    afterOlder?.status,
    "ACTIVE",
    "a stale, older past_due event must never regress an already-newer ACTIVE row"
  );
});

test("an event missing romancePlayerId metadata but also missing organizationId fails loudly rather than silently applying to the wrong tenant", async () => {
  const event = buildRomanceSubscriptionEvent("subscription.active", {
    status: "active",
    metadata: {},
  });
  const { status } = await sendWebhook(event);
  assert.equal(
    status,
    500,
    "an event with neither romancePlayerId nor organizationId metadata must be rejected, never guessed at"
  );
});
