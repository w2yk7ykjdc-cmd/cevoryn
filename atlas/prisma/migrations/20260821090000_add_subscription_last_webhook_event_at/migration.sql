-- Tracks the timestamp of the last Polar webhook event actually applied to
-- this subscription row, so a delayed/retried OLDER event can never
-- overwrite state written by a NEWER event that already arrived (Polar,
-- like any webhook provider, does not guarantee in-order delivery).
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "last_webhook_event_at" TIMESTAMP(3);
