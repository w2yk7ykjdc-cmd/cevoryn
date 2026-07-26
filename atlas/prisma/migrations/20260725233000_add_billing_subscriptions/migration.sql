-- CreateEnum
CREATE TYPE "BillingPlan" AS ENUM ('STARTER', 'PROFESSIONAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM (
  'INCOMPLETE',
  'INCOMPLETE_EXPIRED',
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'UNPAID',
  'PAUSED'
);

-- CreateTable
CREATE TABLE "subscriptions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "stripe_customer_id" TEXT NOT NULL,
  "stripe_subscription_id" TEXT,
  "stripe_price_id" TEXT,
  "plan" "BillingPlan" NOT NULL DEFAULT 'STARTER',
  "subscription_status" "SubscriptionStatus" NOT NULL DEFAULT 'INCOMPLETE',
  "current_period_start" TIMESTAMP(3),
  "current_period_end" TIMESTAMP(3),
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "trial_end" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_webhook_events" (
  "stripe_event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("stripe_event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_organization_id_key"
  ON "subscriptions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_customer_id_key"
  ON "subscriptions"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key"
  ON "subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_subscription_status_idx"
  ON "subscriptions"("subscription_status");

-- CreateIndex
CREATE INDEX "subscriptions_plan_idx"
  ON "subscriptions"("plan");

-- AddForeignKey
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
