# Feature Inventory

Only features actually found in the repository. Production status reflects
what was verified during this session's work on this codebase (real
production testing where noted) — anything not explicitly marked as
production-verified should be read as "present in code, not independently
re-verified live during this documentation pass."

| Feature | Location | Description | Depends on | Production status |
|---|---|---|---|---|
| Email/password + Google sign-in | `src/features/auth/`, `src/app/(auth)/` | Supabase-backed authentication | Supabase Auth | Live — daily-use login path |
| Multi-tenant org/membership | `prisma/schema.prisma` (`Organization`, `Member`, `Invite`), `src/lib/rbac.ts` | Organization-scoped data model, `OWNER`/`ADMIN`/`MEMBER` roles | Postgres | Live |
| Team invites | `src/app/api/team/`, `src/features/team/` | Rate-limited, single-use, email-delivered invites | Resend (optional — falls back to copy-link) | Live |
| Chat | `src/app/(chat)/`, `src/features/ai/` | Streaming AI chat grounded in org context | OpenAI, Postgres | Live — confirmed working via real chat tests this session |
| Brief | `src/app/(dashboard)/brief/`, `src/features/brain/brief/` | On-demand daily summary | Brain pipeline | Live |
| Health / Pulse | `src/app/(dashboard)/health/`, `src/features/brain/pulse/` | Company-health scoring vs. previous snapshot | Brain pipeline | Live |
| Insights | `src/features/brain/insights/` | Pattern detection over conversation history | Brain pipeline, OpenAI | Live |
| Decisions | `src/features/brain/decisions/`, `src/app/(dashboard)/intelligence/` | Structured decision-canvas workflow with confidence/evidence | Brain pipeline | Live |
| Prepared Actions | `src/features/brain/actions/` | AI-drafted next steps requiring human approval | Brain pipeline | Live |
| Outcome evaluation / Learning | `src/features/brain/outcomes/`, `src/features/brain/learning/` | Tracks whether past recommendations succeeded, feeds calibration | Brain pipeline, OpenAI | Live (code path exists; requires resolved decisions to have data to learn from) |
| Company Memory | `src/features/brain/memory/` | Stored facts about the organization, used as chat/AI context | Postgres | Live |
| Google Calendar integration | `src/lib/google-oauth.ts`, `src/app/api/integrations/google/` | OAuth connect, event creation from chat, calendar context in chat | Google Cloud OAuth client | Live — connected and end-to-end verified this session |
| Gmail integration | same as above + `src/features/ai/engine/chat-google-draft.ts` | Draft creation from chat, inbox context in chat | Google Cloud OAuth client | Live — connected this session |
| Billing (Polar) | `src/app/api/billing/`, `src/server/services/billing.service.ts` | Checkout, portal, plan changes, webhook-driven subscription state | Polar.sh | Live — real payment **and** real cancellation both tested end-to-end with real money this session |
| Usage/token metering | `src/server/services/entitlement.service.ts` | Per-org daily AI token budget enforcement | Postgres | Live |
| Analytics | `src/app/api/analytics/`, `AnalyticsEvent` model | In-app event logging | Postgres | Live (writes real rows); no dashboard/visualization built on top of it in this repo |
| i18n (English-only active) | `src/i18n/`, `messages/en.json`, `messages/tr.json` | next-intl; locale forced to English for this release, Turkish infra retained but inactive | next-intl | Live |
| Error tracking | `src/lib/error-reporting.ts`, `instrumentation*.ts` | Sentry client/server capture | Sentry (optional — no-op without `NEXT_PUBLIC_SENTRY_DSN`) | Configured; not independently re-verified this pass |
| Health endpoints | `src/app/api/health/{database,runtime}/route.ts` | Authenticated (CRON_SECRET) infra diagnostics for external uptime monitoring | Postgres | Live |
| Scheduled cleanup jobs | `src/app/api/cron/` | Usage-reservation and billing-hardening-record cleanup | Vercel Cron (`vercel.json`) | Live — 2 daily jobs, confirmed to fit Vercel's Hobby-plan cron limit |
| Custom domain canonicalization | `next.config.ts` | Redirects the raw `cevoryn.vercel.app` domain to `www.cevoryn.com` | Vercel | Live |

## Explicitly not present in this repository

- No book/e-commerce/marketplace features (a prior report describing such
  features was confirmed **not** to belong to this repository — see git
  history note below).
- No Stripe/Paddle integration — billing is Polar-only.
- No admin analytics dashboard UI (raw events are logged, not visualized).
- No automated E2E/browser test suite (unit + integration tests only).
