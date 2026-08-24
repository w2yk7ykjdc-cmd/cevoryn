# Security / Due-Diligence Review

Every item below was checked directly against the current codebase during
this documentation pass (fresh checks, not carried over from memory).
Only what was actually verified is marked as such — anything not checked
is explicitly flagged as unverified rather than assumed.

## Authentication

**Verified.** Supabase Auth is the sole identity provider. Server-side
route/page protection reads the session via `getUser()`/`requireUser()`
(`src/lib/auth.ts`), which validates against Supabase on every call
(cached only per-request via React's `cache()`, not across requests).
`src/middleware.ts` additionally redirects unauthenticated requests to
`/login` for all non-public routes before a page/route handler even runs.

## Authorization (RBAC)

**Verified.** Three roles — `OWNER` / `ADMIN` / `MEMBER` — enforced via
`hasPermission()`/`isRoleAtLeast()` (`src/lib/rbac.ts`). Spot-checked this
session: `/api/brain/memories` DELETE requires `ADMIN`+ (previously did
not — fixed and confirmed in this repo's git history); team-invite
role-assignment restricts who can invite an `ADMIN` to `OWNER` only.

## Ownership / tenant isolation (multi-tenant data scoping)

**Verified for the query patterns checked.** Every Prisma query touched
during this session's work (across `features/brain/*`,
`features/ai/context/context-builder.ts`,
`features/ai/engine/conversation-engine.ts`, billing services) filters by
`organizationId`, either directly or via a `conversation: { organizationId }`
relation join. Two call sites that previously relied solely on an
upstream caller having already validated `conversationId` were hardened
this session to also filter by `organizationId` directly, as
defense-in-depth against a future caller skipping that upstream check.
**Not exhaustively re-audited in this pass**: the full set of ~43 API
routes was not individually re-walked during this specific documentation
session; the tenant-isolation pattern was previously subject to a
dedicated repo-wide audit (referenced in `docs/beta-readiness.md`'s
history) that found no IDOR issues at that time, but that audit's exact
date/scope is not independently re-verified here.

## Secrets handling

**Verified.** Grepped the full `src/` tree for hardcoded API-key-shaped
strings (OpenAI `sk-`, Polar `polar_oat_`, webhook `whsec_` patterns) —
zero matches. All secrets are read from `process.env` and validated at
boot via zod schemas (`src/lib/env.ts`); `.env.example` contains only
placeholder values. `SUPABASE_SERVICE_ROLE_KEY` (the most sensitive key)
is referenced only in server-only files.

## Webhook security

**Verified.** `/api/billing/polar/webhook` verifies the Standard Webhooks
signature (`webhook-signature` header) via Polar's own SDK
(`webhook.verify()`) before parsing the payload; a failed verification
returns 401 without processing the body. Applied events are recorded in a
`BillingWebhookEvent` ledger keyed on `(provider, event_id)` with an
`ON CONFLICT DO NOTHING` guard for idempotency, plus a
`last_webhook_event_at` timestamp guard that rejects an out-of-order
(older, redelivered) event from overwriting state a newer event already
applied — this specific race condition was tested with an integration
test this session (`test/integration/polar-webhook.integration.ts`).

## Rate limiting

**Verified.** Found in 5 API route files (`checkRateLimit`/rate-limit
usage). Confirmed dedicated services exist for: AI chat (token-budget
based, `entitlement.service.ts`), team invites (max invites per hour), and
auth attempts (`auth-rate-limit.service.ts`, with its own cleanup cron
job and Prisma model `AuthRateLimitAttempt`).

## Input validation

**Verified.** 40 files in `src/app/api` and `src/features` use zod
(`z.object`/`.safeParse`) to validate request bodies before use. Spot-
checked the chat, team-invite, and billing routes directly — all validate
before touching the database.

## API security (CSRF / cross-origin)

**Verified.** `src/middleware.ts`'s `isAllowedApiMutation()` rejects any
`POST`/`PUT`/`PATCH`/`DELETE` to `/api/*` where `sec-fetch-site` is
`cross-site`, and further restricts the allowed `Origin` header to the
configured app URL or the request's own forwarded host — applied to every
mutating API route by the middleware matcher (which excludes only static
assets, the health endpoints, the Polar webhook, and cron routes, all of
which have their own independent auth).

## Other findings from this session's work (not re-verified fresh in this pass, but fixed and merged)

- Two `/api/health/*` diagnostic endpoints were previously fully
  unauthenticated (leaking infra details); now gated behind a
  `CRON_SECRET` bearer check.
- `/api/cron/*` was previously reachable through the session-redirect
  middleware path in a way that could prevent Vercel Cron's unauthenticated
  requests from reaching the route at all; fixed by excluding `/api/cron`
  from that middleware matcher.
- Three billing API routes previously relayed raw internal exception
  messages to the client on error; now relay only a safe, explicit
  `PolarApiError`/`PolarConfigurationError` message or a generic fallback.

## Explicitly not covered by this review

- No penetration test or automated security scanner was run.
- Dependency vulnerability scanning (`npm audit` or equivalent) was not
  run as part of this documentation pass.
- Supabase's own platform-level security posture (row-level security
  policies, if any, at the database level beyond what Prisma enforces in
  application code) was not independently reviewed here.
