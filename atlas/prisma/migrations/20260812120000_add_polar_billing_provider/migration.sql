ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "polar_customer_id" TEXT,
  ADD COLUMN IF NOT EXISTS "polar_subscription_id" TEXT,
  ADD COLUMN IF NOT EXISTS "polar_product_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_polar_customer_id_key"
  ON "subscriptions"("polar_customer_id")
  WHERE "polar_customer_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_polar_subscription_id_key"
  ON "subscriptions"("polar_subscription_id")
  WHERE "polar_subscription_id" IS NOT NULL;
