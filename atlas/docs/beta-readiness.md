# CEVORYN Private Beta Readiness

## Current branch

`main`

## Build status

The branch must be considered beta-ready only when the latest Vercel Production deployment succeeds. Vercel's free-tier plan caps deployments at 100/day; if that cap is hit, pushes and merges stop reaching production silently until the cap resets or the plan is upgraded. Check the "Deployments" tab in the Vercel dashboard, not just CI, before assuming a merge shipped.

## Code-complete reliability work

- Authentication redirects preserve safe `next` paths.
- Password-reset request, callback, reset form, session validation, password update, sign-out, and success redirect are connected.
- Chat has loading, error, empty/new-chat, and not-found states.
- Dashboard has loading, error, and not-found states.
- Conversation rename and archive APIs are tenant- and owner-scoped.
- Conversation rename and archive controls are connected to the chat UI.
- Team invite creation is rate-limited.
- Invite acceptance is atomic and single-use.
- Invite renewal rotates tokens and invalidates old links.
- Expired invitations are excluded from active lists.
- Member role changes and removals are organization-scoped and race-resistant.
- Critical chat and team APIs use the shared safe API error format.
- Paddle checkout, portal, and webhook routes are excluded from the session-auth middleware (they verify their own signature instead) so Paddle can actually deliver webhook events.

## Confirmed manual checks

- Preview application opens.
- Sign-in succeeds.
- Chat returns an AI response.
- A new conversation can be created.
- Production `/api/health` returns `200` with `services.database: "connected"`.
- Production `POST /api/billing/paddle/webhook` returns a signature-verification response instead of a login redirect.

## Final manual acceptance checks

These require a real browser, email delivery, and authenticated user interaction:

1. Rename a conversation and refresh the page.
2. Archive a conversation and confirm it disappears from the active list.
3. Request a password-reset email, open the link, set a new password, and sign in with it.
4. Create, renew, and revoke a team invitation.
5. Accept an invitation with a separate test account.
6. Verify mobile chat input remains visible above the keyboard.
7. Complete a Paddle sandbox checkout end-to-end and confirm the `subscriptions` row updates via the webhook (not yet run - see "Billing readiness" below).

## Billing readiness

- [x] Ran `scripts/audit-stale-identifiers.sql` (queries 1, 5, and 4) against production via the Supabase SQL Editor. Found and fixed a real regression: `organizations` has a row with `name = "atlas"`, `slug = "atlas"` (the founder's own workspace) that the AI system prompt's "product owner" context depends on matching - see #48. No duplicate `subscriptions` rows per organization (0 rows) and no orphaned `subscriptions` rows with a missing organization (0 rows) - both clean.
- [x] `prisma migrate deploy` confirmed applied to the production database - the `subscriptions` table queries above returned real data (not a "relation does not exist" error), confirming at least that migration is live.
- [x] Confirmed all six Paddle env vars (`PADDLE_ENV`, `PADDLE_API_KEY`, `PADDLE_PRICE_STARTER/PROFESSIONAL/BUSINESS`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`) exist in Vercel for Production and Preview. Vercel masks the actual values in the UI and the project owner chose not to reveal them for this check, so the *exact* sandbox-vs-production consistency of the values themselves was not verified - only that all six are present.
- [x] Google Cloud OAuth client's authorized JavaScript origin and redirect URI updated to `https://cevoryn.vercel.app` and `https://cevoryn.vercel.app/api/integrations/google/callback` (confirmed via screenshot they were still registered against the legacy `atlas-wb6b.vercel.app` domain; the stale entries have been removed).
- [x] Legacy Stripe integration (`/api/stripe/webhook`, `src/lib/stripe/*`, the `stripe` npm dependency) removed - confirmed no active Stripe customers depend on it. The `subscriptions` table still has `stripe_customer_id`/`stripe_subscription_id`/`stripe_price_id` columns; those are kept as-is (Paddle rows populate `stripe_customer_id` with a `paddle:<id>` placeholder to satisfy the `NOT NULL` constraint from the original migration) rather than doing a separate column-rename migration.
- [x] A genuine Paddle sandbox account/API key does exist for this vendor (`pdl_sdbx_apikey_...`, found under the sandbox toggle on vendors.paddle.com). Verified via a temporary CI job against `sandbox-api.paddle.com`: all three configured price IDs (Starter, Professional, Business) return `200 OK` with active status under the correct `CEVORYN` product. Static code review (see #50) also found and fixed a real bug: the checkout route's duplicate-subscription guard checked a field (`stripeSubscriptionId`) that Paddle-originated rows never populate, so it could never block a customer with an active Paddle subscription from starting a second checkout.
- [ ] Full browser-driven sandbox checkout (Paddle.js overlay + webhook delivery + `subscriptions` row update) has not been run yet - the catalog check above only confirmed the API credentials and price IDs are valid, not the end-to-end flow.

## Release boundary

Passing the final checks makes CEVORYN suitable for a small, controlled private beta. It does not yet certify enterprise readiness, formal penetration testing, legal compliance, or large-scale production usage.
