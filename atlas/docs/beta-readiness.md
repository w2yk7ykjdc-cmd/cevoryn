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

1. [x] Rename a conversation and refresh the page - persists.
2. [x] Archive a conversation and confirm it disappears from the active list - confirmed.
3. [x] Request a password-reset email, open the link, set a new password, and sign in with it - confirmed end-to-end.
4. [ ] Create, renew, and revoke a team invitation - blocked: the default (no-subscription) plan only supports 1 team member, so inviting a second member requires an active paid subscription, which requires the still-blocked Paddle checkout below.
5. [ ] Accept an invitation with a separate test account - blocked on the same team-size limit as #4.
6. [x] Verify mobile chat input remains visible above the keyboard - confirmed.
7. [ ] Complete a Paddle sandbox checkout end-to-end and confirm the `subscriptions` row updates via the webhook (not yet run - see "Billing readiness" below).

## Billing readiness

- [x] Ran `scripts/audit-stale-identifiers.sql` (queries 1, 5, and 4) against production via the Supabase SQL Editor. Found and fixed a real regression: `organizations` has a row with `name = "atlas"`, `slug = "atlas"` (the founder's own workspace) that the AI system prompt's "product owner" context depends on matching - see #48. No duplicate `subscriptions` rows per organization (0 rows) and no orphaned `subscriptions` rows with a missing organization (0 rows) - both clean.
- [x] `prisma migrate deploy` confirmed applied to the production database - the `subscriptions` table queries above returned real data (not a "relation does not exist" error), confirming at least that migration is live.
- [x] All six Paddle env vars (`PADDLE_ENV`, `PADDLE_API_KEY`, `PADDLE_PRICE_STARTER/PROFESSIONAL/BUSINESS`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`) confirmed correct and consistent in Vercel Production. This took several rounds to actually verify: `PADDLE_ENV` was silently stuck on a stale value after earlier edits, a rotated `PADDLE_API_KEY` was created under the wrong Paddle account, and one price ID was mistyped a character short. Each was isolated with a temporary CI job hitting `sandbox-api.paddle.com` directly (bypassing Vercel entirely) until all three `PADDLE_PRICE_*` values were confirmed `200 OK` and `active` under the same `CEVORYN` sandbox product. `/settings/billing` now shows live prices ($29/$79/$199) in production.
- [x] Google Cloud OAuth client's authorized JavaScript origin and redirect URI updated to `https://cevoryn.vercel.app` and `https://cevoryn.vercel.app/api/integrations/google/callback` (confirmed via screenshot they were still registered against the legacy `atlas-wb6b.vercel.app` domain; the stale entries have been removed).
- [x] Google account connect was still failing in production with `redirect_uri_mismatch` days after the above fix - the actual cause was that Vercel's `NEXT_PUBLIC_APP_URL` env var itself was still set to the legacy `atlas-wb6b.vercel.app` value (`src/lib/google-oauth.ts` builds the redirect URI from this var). Updated to `https://cevoryn.vercel.app` in Vercel Production and confirmed end-to-end: Google account connects, and "Create Gmail test draft" successfully creates a draft.
- [x] Legacy Stripe integration (`/api/stripe/webhook`, `src/lib/stripe/*`, the `stripe` npm dependency) removed - confirmed no active Stripe customers depend on it. The `subscriptions` table still has `stripe_customer_id`/`stripe_subscription_id`/`stripe_price_id` columns; those are kept as-is (Paddle rows populate `stripe_customer_id` with a `paddle:<id>` placeholder to satisfy the `NOT NULL` constraint from the original migration) rather than doing a separate column-rename migration.
- [x] A genuine Paddle sandbox account/API key does exist for this vendor (`pdl_sdbx_apikey_...`, found under the sandbox toggle on vendors.paddle.com). Verified via a temporary CI job against `sandbox-api.paddle.com`: all three configured price IDs (Starter, Professional, Business) return `200 OK` with active status under the correct `CEVORYN` product. Static code review (see #50) also found and fixed a real bug: the checkout route's duplicate-subscription guard checked a field (`stripeSubscriptionId`) that Paddle-originated rows never populate, so it could never block a customer with an active Paddle subscription from starting a second checkout.
- [ ] Full browser-driven sandbox checkout (Paddle.js overlay + webhook delivery + `subscriptions` row update) has not been run yet - the catalog check above only confirmed the API credentials and price IDs are valid, not the end-to-end flow.
- [x] `/settings/billing` plan cards now show a real price per plan (fetched live from Paddle's Prices API - see #52), and the feature/limit bullets are derived directly from `PLAN_CONFIG` instead of a hand-maintained list that had drifted (Business was missing "CEVORYN Brain" and "Advanced reports" even though the plan actually includes both).
- [x] `/settings/billing` is now reachable - it existed but had no link from the sidebar, mobile nav, or the Settings page itself (fixed in #52).
- [x] Production canonicalization now covers every non-canonical host, not just the one legacy domain: any host other than `cevoryn.vercel.app` redirects to it when `VERCEL_ENV === "production"`, including Vercel's per-deployment preview-style URLs (`<project>-<hash>-<team>.vercel.app`) which are otherwise always live in parallel with the alias.

## Known open work outside this branch

- PR #37 (`feature/team-management-ui`) - closed as redundant; `/team` already exists and is reachable on `main`.
- PR #35 (`feature/iyzico-subscriptions`) - closed; Paddle is the live, working billing provider.
- Issues #17, #4, #1 - closed as superseded by this document.

## Release boundary

Passing the final checks makes CEVORYN suitable for a small, controlled private beta. It does not yet certify enterprise readiness, formal penetration testing, legal compliance, or large-scale production usage.
