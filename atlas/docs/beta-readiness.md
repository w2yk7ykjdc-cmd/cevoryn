# CEVORYN Private Beta Readiness

## Current branch

`main`

## Build status

The branch must be considered beta-ready only when the latest Vercel Production deployment succeeds. Vercel's free-tier plan caps deployments at 100/day; if that cap is hit, pushes and merges stop reaching production silently until the cap resets or the plan is upgraded. Check the "Deployments" tab in the Vercel dashboard, not just CI, before assuming a merge shipped.

### Cron limits (verified 2026-10-10)

Current `atlas/vercel.json` defines 4 daily cron jobs:

- `/api/cron/cleanup-usage-reservations` — `0 3 * * *` (03:00 UTC)
- `/api/cron/cleanup-billing-hardening-records` — `30 3 * * *` (03:30 UTC)
- `/api/cron/radar-ingest` — `0 6 * * *` (06:00 UTC)
- `/api/cron/learning-cycle` — `0 7 * * *` (07:00 UTC)

Vercel's current documentation (updated January 2026) allows up to 100 cron jobs per project on every plan. The Hobby plan restriction is **frequency**, not a two-job total: each cron must run no more than once per day, with invocation timing only guaranteed within the configured hour (±59 minutes). Pro and Enterprise support per-minute scheduling precision and more frequent schedules. The four current expressions satisfy Hobby's once-per-day frequency rule; do not describe a third daily job alone as requiring Pro.

Operational caveats: Vercel does not automatically retry a failed cron invocation, and cron requests do not follow redirects. Verify executions in Vercel Dashboard → Settings → Cron Jobs → View Logs; a green GitHub CI run does not prove that scheduled production invocations are firing. Sources: [Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) and [Cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

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
- The active B2B billing flow is Polar: `/api/billing/polar/checkout`, `/api/billing/portal`, and `/api/billing/polar/webhook`. Middleware excludes the Polar webhook route so provider-signed events can reach its own signature verification. Paddle notes below are historical migration evidence, not the current provider.
- Decision confidence calibration is exercised end-to-end in the real-Postgres integration suite: `generateDecisionCanvas()` is called with a deterministic provider and real stored outcomes, and the returned confidence is asserted to be calibrated. PR #266 CI passed; this proves the code path under test, not production-provider quality or live-production deployment.

## Confirmed manual checks

- Preview application opens.
- Sign-in succeeds.
- Chat returns an AI response.
- A new conversation can be created.
- Historical manual check: production `/api/health` returned `200` with
  `services.database: "connected"`. This is not a current-turn live
  verification and must not be used as proof of present health. The
  scheduled Production Smoke workflow is configured to probe the canonical
  host, but no recent Production Smoke run was found in the Actions runs
  inspected on 2026-10-10.
- Historical check only: the former Paddle webhook endpoint returned a signature-verification response rather than a login redirect. The current webhook endpoint is `/api/billing/polar/webhook`; its live production delivery/signature path must be verified against the current deployment.

## Final manual acceptance checks

These require a real browser, email delivery, and authenticated user interaction.
Items marked historically complete are not proof of current production state.
Before sale, repeat the critical checks against the currently deployed commit
and retain timestamped evidence:

1. [x] Rename a conversation and refresh the page - persists.
2. [x] Archive a conversation and confirm it disappears from the active list - confirmed.
3. [x] Request a password-reset email, open the link, set a new password, and sign in with it - confirmed end-to-end.
4. [ ] Create, renew, and revoke a team invitation - now unblocked (a real ACTIVE subscription exists after the webhook fix below); not yet tested.
5. [ ] Accept an invitation with a separate test account - not yet tested.
6. [ ] Verify current production health probe and confirm its reported commit
   matches the intended release; preserve the workflow run and response.
7. [ ] Verify the current Polar checkout → signed webhook → database
   subscription → entitlement flow, then cancellation/portal behavior, using
   a controlled test account and retain provider/database evidence.
8. [ ] Verify the live Thornbound 18+ route/action guard, configured safety
   classifier behavior, user-facing rejection behavior, and production audit
   logs (tracked in issue #260).
6. [x] Verify mobile chat input remains visible above the keyboard - confirmed.
7. [x] Historical Paddle sandbox checkout and webhook synchronization were confirmed before the provider migration. This does **not** verify the current Polar checkout/webhook path; current live-provider acceptance must be tracked separately.

## Historical Paddle migration evidence (not the current billing provider)

- [x] Ran `scripts/audit-stale-identifiers.sql` (queries 1, 5, and 4) against production via the Supabase SQL Editor. Found and fixed a real regression: `organizations` has a row with `name = "atlas"`, `slug = "atlas"` (the founder's own workspace) that the AI system prompt's "product owner" context depends on matching - see #48. No duplicate `subscriptions` rows per organization (0 rows) and no orphaned `subscriptions` rows with a missing organization (0 rows) - both clean.
- [x] `prisma migrate deploy` confirmed applied to the production database - the `subscriptions` table queries above returned real data (not a "relation does not exist" error), confirming at least that migration is live.
- [x] All six Paddle env vars (`PADDLE_ENV`, `PADDLE_API_KEY`, `PADDLE_PRICE_STARTER/PROFESSIONAL/BUSINESS`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`) confirmed correct and consistent in Vercel Production. This took several rounds to actually verify: `PADDLE_ENV` was silently stuck on a stale value after earlier edits, a rotated `PADDLE_API_KEY` was created under the wrong Paddle account, and one price ID was mistyped a character short. Each was isolated with a temporary CI job hitting `sandbox-api.paddle.com` directly (bypassing Vercel entirely) until all three `PADDLE_PRICE_*` values were confirmed `200 OK` and `active` under the same `CEVORYN` sandbox product. `/settings/billing` now shows live prices ($29/$79/$199) in production.
- [x] Google Cloud OAuth client's authorized JavaScript origin and redirect URI updated to `https://cevoryn.vercel.app` and `https://cevoryn.vercel.app/api/integrations/google/callback` (confirmed via screenshot they were still registered against the legacy `atlas-wb6b.vercel.app` domain; the stale entries have been removed).
- [x] Google account connect was still failing in production with `redirect_uri_mismatch` days after the above fix - the actual cause was that Vercel's `NEXT_PUBLIC_APP_URL` env var itself was still set to the legacy `atlas-wb6b.vercel.app` value (`src/lib/google-oauth.ts` builds the redirect URI from this var). Updated to `https://cevoryn.vercel.app` in Vercel Production and confirmed end-to-end: Google account connects, and "Create Gmail test draft" successfully creates a draft.
- [x] Legacy Stripe integration (`/api/stripe/webhook`, `src/lib/stripe/*`, the `stripe` npm dependency) removed - confirmed no active Stripe customers depend on it. The `subscriptions` table still has `stripe_customer_id`/`stripe_subscription_id`/`stripe_price_id` columns; those are kept as-is (Paddle rows populate `stripe_customer_id` with a `paddle:<id>` placeholder to satisfy the `NOT NULL` constraint from the original migration) rather than doing a separate column-rename migration.
- [x] A genuine Paddle sandbox account/API key does exist for this vendor (`pdl_sdbx_apikey_...`, found under the sandbox toggle on vendors.paddle.com). Verified via a temporary CI job against `sandbox-api.paddle.com`: all three configured price IDs (Starter, Professional, Business) return `200 OK` with active status under the correct `CEVORYN` product. Static code review (see #50) also found and fixed a real bug: the checkout route's duplicate-subscription guard checked a field (`stripeSubscriptionId`) that Paddle-originated rows never populate, so it could never block a customer with an active Paddle subscription from starting a second checkout.
- [x] Full browser-driven sandbox checkout (Paddle.js overlay) now completes successfully end-to-end: the domain had to be approved directly in the _sandbox_ Paddle dashboard (a separate approval list from the live dashboard - the earlier approval was on the wrong one), and a "Default payment link" had to be set in Checkout settings (`transaction_default_checkout_url_not_set` otherwise).
- [x] Webhook delivery confirmed working end-to-end. Two separate root causes, found via Paddle's API directly (the sandbox UI never exposes the raw secret in a way that's unambiguous to copy): (1) Paddle's real webhook secret is prefixed `pdl_ntfset_...`; the value saved in Vercel's `PADDLE_WEBHOOK_SECRET` was missing that prefix (effectively the destination ID, not the secret), so it could never have verified a real Paddle-signed request. (2) The active notification destination was only subscribed to `transaction.*` events, not `subscription.*` - the events our webhook handler actually processes - so even with a correct secret, no relevant event would ever have been delivered. Fixed both: corrected `PADDLE_WEBHOOK_SECRET` in Vercel to the full `pdl_ntfset_...` value and updated the destination's `subscribed_events` to the five `subscription.*` events. A fresh sandbox checkout after both fixes produced a real `subscriptions` row.
- [x] `/settings/billing` plan cards now show a real price per plan (fetched live from Paddle's Prices API - see #52), and the feature/limit bullets are derived directly from `PLAN_CONFIG` instead of a hand-maintained list that had drifted (Business was missing "CEVORYN Brain" and "Advanced reports" even though the plan actually includes both).
- [x] `/settings/billing` is now reachable - it existed but had no link from the sidebar, mobile nav, or the Settings page itself (fixed in #52).
- [x] Canonical redirect is configured in `atlas/next.config.ts`: requests whose host is `cevoryn.vercel.app` redirect to `https://www.cevoryn.com/:path*`. The current source does not establish that every arbitrary or per-deployment Vercel host is redirected; verify actual production host behavior separately before claiming broader canonicalization coverage.

## Current open verification and release blockers (2026-10-10)

- [ ] **Romance safety gate requires CI and manual verification.** Issue [#260](https://github.com/w2yk7ykjdc-cmd/cevoryn/issues/260) remains open. PR [#262](https://github.com/w2yk7ykjdc-cmd/cevoryn/pull/262) added fail-closed adult eligibility and malformed/unknown canon-claim checks; PR [#265](https://github.com/w2yk7ykjdc-cmd/cevoryn/pull/265) adds typed relationship/family eligibility, structured safety classification, deterministic metadata checks, local preflight, and fail-closed retry/fallback behavior. Do not call the gate release-verified until the latest CI passes and live/manual acceptance checks are recorded.
- [ ] **Production health check:** the previous Production Smoke failures were traced to probing the redirected `cevoryn.vercel.app` host. [PR #261](https://github.com/w2yk7ykjdc-cmd/cevoryn/pull/261) has been merged and its CI passed; the live health endpoint still needs a successful production smoke invocation to confirm the issue is resolved in production.
- [ ] **Team invitations:** create/renew/revoke and accept an invitation with a separate test account remain manual acceptance checks above.
- [ ] **Cron execution:** all four configured jobs use daily schedules that satisfy Hobby frequency limits, but verify each job's actual production execution in Vercel Cron Jobs logs. Vercel does not automatically retry failed cron invocations.

Historical cleanup: PR #37 (`feature/team-management-ui`) was closed as redundant because `/team` already exists; PR #35 (`feature/iyzico-subscriptions`) was closed because Paddle was the billing provider at that time. The current B2B billing code uses Polar. Issues #17, #4, and #1 were previously closed as superseded; the invite manual acceptance checks above remain valid.

## Release boundary

Passing automated CI is necessary but not sufficient for a release. A controlled private beta requires the outstanding manual checks above and the Romance safety gate must remain explicitly marked incomplete until issue #260's acceptance criteria are implemented and verified. This document does not certify enterprise readiness, formal penetration testing, legal compliance, or large-scale production usage.

**Current billing status (code review, 2026-10-10):** the B2B billing UI calls `/api/billing/polar/checkout`; portal calls `/api/billing/portal`; webhook processing is implemented at `/api/billing/polar/webhook`; middleware excludes that Polar webhook path. No `/api/billing/paddle/*` routes are present in the current route tree. `FEATURE_INVENTORY.md` records Polar payment and cancellation as previously tested with real money, but that historical assertion was not independently re-verified during this audit. Current live Polar checkout, cancellation, webhook delivery, and production deployment remain **not re-verified in this pass**.
