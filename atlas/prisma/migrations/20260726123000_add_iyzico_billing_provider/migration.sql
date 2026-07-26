ALTER TABLE "subscriptions"
  ALTER COLUMN "stripe_customer_id" DROP NOT NULL,
  ADD COLUMN "billing_provider" TEXT NOT NULL DEFAULT 'STRIPE',
  ADD COLUMN "iyzico_customer_reference_code" TEXT,
  ADD COLUMN "iyzico_subscription_reference_code" TEXT,
  ADD COLUMN "iyzico_pricing_plan_reference_code" TEXT;

CREATE UNIQUE INDEX "subscriptions_iyzico_customer_reference_code_key"
  ON "subscriptions"("iyzico_customer_reference_code")
  WHERE "iyzico_customer_reference_code" IS NOT NULL;

CREATE UNIQUE INDEX "subscriptions_iyzico_subscription_reference_code_key"
  ON "subscriptions"("iyzico_subscription_reference_code")
  WHERE "iyzico_subscription_reference_code" IS NOT NULL;

CREATE TABLE "billing_webhook_events" (
  "provider" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("provider", "event_id")
);
