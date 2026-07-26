ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "paddle_customer_id" TEXT,
  ADD COLUMN IF NOT EXISTS "paddle_subscription_id" TEXT,
  ADD COLUMN IF NOT EXISTS "paddle_price_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_paddle_customer_id_key"
  ON "subscriptions"("paddle_customer_id")
  WHERE "paddle_customer_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_paddle_subscription_id_key"
  ON "subscriptions"("paddle_subscription_id")
  WHERE "paddle_subscription_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "billing_webhook_events" (
  "provider" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("provider", "event_id")
);
