-- Read-only inspection queries for the "Atlas" -> "CEVORYN" rebrand audit.
--
-- Context: src/features/ai/context/prompts.ts special-cases the AI system
-- prompt for whichever organization is literally named the product's own
-- brand name (used to be "Atlas", now compared against "CEVORYN" after the
-- code fix in this PR). If the founder's own workspace was renamed from
-- "Atlas" to something other than "Cevoryn" during the rebrand, that special
-- context block has been silently disabled since the rename. These queries
-- do not modify any data — run them to decide whether a data fix is needed.
--
-- This script was NOT executed against production; no database credentials
-- were available in the environment that produced it. Run it yourself with
-- `psql "$DATABASE_URL" -f scripts/audit-stale-identifiers.sql`.

-- 1. Organizations whose name still literally matches the old brand.
SELECT id, name, slug, created_at
FROM organizations
WHERE lower(trim(name)) = 'atlas';

-- 2. Organizations named after the new brand (sanity check: should include
--    the founder's own workspace if the rename happened correctly).
SELECT id, name, slug, created_at
FROM organizations
WHERE lower(trim(name)) = 'cevoryn';

-- 3. All organizations, for manual eyeballing if neither of the above
--    returns the expected row (e.g. the workspace uses a different name
--    entirely, or a slug like "atlas" or "kemal").
SELECT id, name, slug, created_at
FROM organizations
ORDER BY created_at ASC;

-- 4. Subscriptions with no matching organization (orphaned rows). Requires
--    the "subscriptions" table from prisma/migrations/20260725233000_*
--    and 20260726161000_* to be applied.
SELECT s.id, s.organization_id, s.plan, s.subscription_status,
       s.stripe_customer_id, s.paddle_customer_id
FROM subscriptions s
LEFT JOIN organizations o ON o.id = s.organization_id
WHERE o.id IS NULL;

-- 5. Organizations with more than one subscription row (should be
--    impossible given the unique index on organization_id, but check
--    anyway in case of a manual data fix gone wrong).
SELECT organization_id, count(*)
FROM subscriptions
GROUP BY organization_id
HAVING count(*) > 1;

-- 6. Subscriptions whose stripe_customer_id uses the synthetic
--    "paddle:<customer_id>" placeholder (see the webhook handler in
--    src/app/api/billing/paddle/webhook/route.ts). This is expected for
--    every Paddle-originated subscription and is not itself a bug -
--    listed here only so it's not mistaken for a data problem.
SELECT id, organization_id, stripe_customer_id, paddle_customer_id, plan, subscription_status
FROM subscriptions
WHERE stripe_customer_id LIKE 'paddle:%';
