# Architecture

## Application structure

Next.js App Router. Route groups separate the unauthenticated marketing/
auth surface from the authenticated dashboard/chat surface:

```
src/app/
├── (auth)/          login, signup, forgot-password, reset-password
├── (dashboard)/     dashboard (home), brief, health, intelligence,
│                    profile, settings, settings/billing, team, feedback,
│                    analytics
├── (chat)/          chat, chat/[id]
├── onboarding/       first-run workspace setup
├── invite/[token]/   invite acceptance (unauthenticated entry point)
├── pricing/ privacy/ terms/ refunds/   public/legal pages
└── api/              43 route handlers (full list below)
```

`src/middleware.ts` runs on every request except a short exclusion list
(static assets, `/api/health`, the Polar webhook, and `/api/cron/*`): it
enforces the Supabase session cookie for protected routes and blocks
cross-site API mutations (CSRF defense — rejects `POST/PUT/PATCH/DELETE`
to `/api/*` unless the request's origin matches the configured app URL or
`x-forwarded-host`).

## Major modules (`src/features/`)

| Module | Responsibility |
|---|---|
| `features/ai` | Chat streaming engine, OpenAI provider abstraction, Google-integration chat actions (calendar event / Gmail draft creation from natural language), system-prompt construction |
| `features/auth` | Auth server actions, auth-specific rate limiting |
| `features/brain` | The "Brain" subsystem: `memory/` (stored company facts), `insights/` (pattern detection over conversations), `pulse/` (company-health scoring), `brief/` (daily summary generation), `decisions/` (decision-canvas workflow), `outcomes/` (outcome evaluation), `learning/` (pattern/recommendation analytics), `actions/` (prepared-action queue), `trust/` (evidence/confidence envelope shared across Brain outputs) |
| `features/billing` | Client-side billing UI actions (checkout/portal/plan-change triggers) |
| `features/executive` | Composes the dashboard "executive home" view from Brain outputs |
| `features/onboarding` | First-run workspace setup flow |
| `features/team` | Team invite email templating |

## API routes (43 total)

```
/api/admin/billing/verify-subscription   /api/admin/test-data
/api/analytics
/api/billing/change-plan   /api/billing/polar/checkout   /api/billing/polar/webhook   /api/billing/portal
/api/brain/actions  /api/brain/actions/[id]
/api/brain/brief
/api/brain/decision-canvas
/api/brain/decisions  /api/brain/decisions/[id]
/api/brain/insights
/api/brain/learning
/api/brain/memories
/api/brain/outcomes
/api/brain/pulse
/api/brain/recommendation-history  /api/brain/recommendation-metrics  /api/brain/recommendations
/api/brain/timeline
/api/chat
/api/client-errors
/api/conversations  /api/conversations/[id]
/api/cron/cleanup-billing-hardening-records  /api/cron/cleanup-usage-reservations
/api/health  /api/health/database  /api/health/runtime
/api/integrations/google/actions/calendar-event  /api/integrations/google/actions/email-draft
/api/integrations/google/callback  /api/integrations/google/connect
/api/integrations/google/context  /api/integrations/google/disconnect  /api/integrations/google/status
/api/organizations/active
/api/settings/email  /api/settings/organization  /api/settings/profile
/api/team/invite  /api/team/invite/[id]  /api/team/invite/accept
/api/team/members/[memberId]
```

## Database (Prisma models, 19 total)

`Organization`, `Member`, `Invite` — tenancy and membership.
`Conversation`, `Message`, `UsageRecord` — chat and AI-usage metering.
`AnalyticsEvent` — in-app event logging.
`Memory`, `Insight`, `PulseSnapshot`, `Brief`, `PreparedAction` — Brain
subsystem outputs.
`Decision`, `DecisionTimelineEvent`, `OutcomeEvaluation`,
`LearningPattern` — decision workflow and outcome learning.
`Subscription`, `BillingWebhookEvent` — Polar billing state and webhook
idempotency ledger.
`AuthRateLimitAttempt` — auth rate-limit tracking.

Every tenant-scoped table carries an `organizationId` (or reaches one via
a direct relation) and every query in `src/features/*` and
`src/server/services/*` filters by it — see
[`SECURITY_DUE_DILIGENCE.md`](SECURITY_DUE_DILIGENCE.md) for the tenant-
isolation verification.

Migrations live in `prisma/migrations/` and are **not** run automatically
on deploy by any external system — see
[`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) for how they're applied.

## AI architecture

1. `/api/chat` validates the request (session, org membership, zod schema
   for the message body) and confirms the target conversation belongs to
   the caller's organization and was created by the caller
   (`getConversation(id, organizationId, createdById)`) before doing
   anything else.
2. `sendMessage()` → `streamResponse()` (`features/ai/engine/conversation-engine.ts`)
   checks a Google-integration action shortcut first (explicit "create a
   calendar event" / "create a Gmail draft" requests bypass the general
   chat model and go through a narrower, purpose-built extraction call).
3. Otherwise, `buildContext()` (`features/ai/context/context-builder.ts`)
   assembles the system prompt: organization context, Brain module
   outputs (memories, insights, decisions), workspace telemetry, and (if
   Google is connected) recent Gmail/Calendar signals — explicitly labeled
   as untrusted, non-priority raw signals in the prompt itself.
4. The OpenAI provider streams the response back over SSE; usage is
   recorded and checked against `DAILY_TOKEN_LIMIT_PER_ORG` both before
   and after the call.

## Auth architecture

Supabase Auth is the identity provider (email+password and Google OAuth
sign-in). No `User` table exists in this app's own Prisma schema —
`Member.userId` stores Supabase's own user UUID, and email/display name
are always read live from the current Supabase session
(`getUser()`/`requireUser()` in `src/lib/auth.ts`), never duplicated into
this app's database. This means an email change via Supabase Auth is
safe-by-construction for every other table, since nothing else keys on
email.

## Billing architecture

Polar.sh is the billing provider. `/api/billing/polar/webhook` verifies
the Standard Webhooks signature before processing any event, applies
events idempotently via a `BillingWebhookEvent` ledger keyed on
`(provider, event_id)`, and rejects out-of-order redeliveries via a
`last_webhook_event_at` guard on `Subscription` (an older event arriving
after a newer one was already applied is a no-op, not a regression).
Checkout and the billing portal are both initiated via
`/api/billing/polar/checkout` and `/api/billing/portal`, which redirect
the user into Polar's own hosted flow — no card data ever touches this
app's servers.

## Integration architecture (Google Calendar / Gmail)

OAuth2 authorization-code flow (`/api/integrations/google/connect` →
Google → `/api/integrations/google/callback`). Access/refresh tokens are
encrypted at rest (AES-256-GCM, key from `GOOGLE_TOKEN_ENCRYPTION_KEY`)
before being stored. `src/lib/google-context.ts` pulls a bounded set of
recent Gmail messages (subject/sender/date/snippet, last 7 days, max 5)
and upcoming Calendar events into the chat context on every turn once
connected — explicitly labeled in the prompt as untrusted, non-priority
raw signal data (see `docs/transfer/SECURITY_DUE_DILIGENCE.md` for why
this labeling exists). Two chat-triggered write actions exist: creating a
real Calendar event and creating a real Gmail draft, both gated behind an
explicit-intent regex/LLM-extraction step so the AI never creates either
without the user unambiguously asking for it.
