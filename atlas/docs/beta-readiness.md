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

## Billing readiness (not yet confirmed)

- [ ] Run `scripts/audit-stale-identifiers.sql` against production to confirm no organization is silently missing the AI system prompt's "product owner" context (see `features/ai/context/prompts.ts`).
- [ ] Confirm `prisma migrate deploy` has actually been applied to the production database - `npm run build` does not run migrations automatically, so `google_connections`, `subscriptions`, and `billing_webhook_events` must be verified to exist.
- [ ] Confirm `PADDLE_ENV`, `PADDLE_API_KEY`, `PADDLE_PRICE_STARTER/PROFESSIONAL/BUSINESS`, and `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` all belong to the same environment (sandbox or production) in Vercel.
- [ ] Confirm the Google Cloud OAuth client's redirect URI exactly matches `<NEXT_PUBLIC_APP_URL>/api/integrations/google/callback` for the current production domain.
- [ ] Decide whether the legacy Stripe integration (`/api/stripe/webhook`, `src/lib/stripe/*`) is still needed for existing Stripe customers, or can be removed now that checkout/portal are Paddle-only. Do not remove it without confirming no active Stripe subscriptions depend on it.
- [ ] Complete a real Paddle sandbox checkout end-to-end.

## Release boundary

Passing the final checks makes CEVORYN suitable for a small, controlled private beta. It does not yet certify enterprise readiness, formal penetration testing, legal compliance, or large-scale production usage.
