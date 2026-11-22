# CEVORYN — AI Chief of Staff for Small Teams

**Asset sale.** Full codebase, domain, and brand. Pre-revenue: zero
verified customers and zero verified revenue. This teaser makes no
revenue-multiple or traction claim. Current production and third-party
service status must be re-verified before buyer representations.

## What it is

CEVORYN is a B2B SaaS "AI Chief of Staff": an organization connects its
context (conversations, calendar, Gmail) and CEVORYN's AI pipeline ("the
Brain") turns that into a daily Brief, a company-health Pulse score,
pattern-based Insights, structured Decisions with confidence scoring, and
AI-drafted Prepared Actions a human approves before anything happens. A
companion module, Radar, watches external signals (news, press releases,
SEC filings, job postings) for opportunities/threats tied to tracked
companies.

## Tech stack

- Next.js 15.5 / React 19 / TypeScript (strict)
- Prisma 6.19 → Postgres (Supabase)
- Supabase Auth (email/password + Google sign-in)
- OpenAI (chat + structured generation)
- Polar.sh (subscription billing — Starter/Professional/Business)
- Google Calendar/Gmail (OAuth integration)
- Vercel (hosting, cron, domain)
- Optional: Sentry (errors), Resend (invite email)

## What's built and working

- Multi-tenant org/membership model with OWNER/ADMIN/MEMBER RBAC
- Streaming AI chat grounded in org context
- Brain pipeline: Brief, Pulse, Insights, Decisions, Prepared Actions,
  Outcome evaluation / learning loop, Company Memory
- Radar: external entity tracking, opportunity/threat generation,
  proprietary-data ingestion gated by plan tier
- Team invites (rate-limited, single-use, email-delivered)
- Google Calendar + Gmail integration (connect, create events, draft
  email, use as chat context)
- Full Polar billing lifecycle: checkout, portal, plan changes,
  signature-verified webhooks, idempotent event processing
- Audit log with CSV export, usage/token metering per org
- i18n infrastructure present (English active; Turkish retained but
  inactive)

## Quality signals

- Automated unit and integration test suites are configured in CI; current pass counts are intentionally omitted until the sale branch is freshly tested
- TypeScript strict mode; current type-check/lint status is not represented as freshly verified
- Security review covering auth, RBAC, tenant isolation, secrets
  handling, webhook signature verification, rate limiting, input
  validation (zod on all mutating routes), and CSRF/cross-origin
  protection — see `SECURITY_DUE_DILIGENCE.md`
- Security review findings and known unverified areas are disclosed in `SECURITY_DUE_DILIGENCE.md`; repository-level scanner status must be checked in GitHub before making a buyer claim
- Non-squashed git history — the actual development process is visible,
  not a single snapshot commit

## Honest current state

- **Zero verified customers, zero verified revenue.** This is an asset acquisition, not a business with demonstrated traction. See `BUYER_DUE_DILIGENCE.md`.
- Playwright browser smoke tests are configured in CI; comprehensive authenticated end-to-end coverage has not been established by this review.
- Cost-optimized AI model (`gpt-4o-mini`) by default — configurable.
- Runs on free/hobby tiers (Supabase, Vercel) — no automatic DB backups
  until upgraded.

## What's included in this sale

- Full source code + complete, non-squashed git history
- `cevoryn.com` / `www.cevoryn.com` (Vercel-managed domain)
- Brand assets (logo, favicon, OG image, in-app branding)
- Production database contents, if any, via Supabase project handover
- This full technical documentation set (`docs/transfer/`)

**Not included:** a separate 18+ interactive-fiction module ("Thornbound")
that existed in a different branch of this codebase has been fully
removed from this sale snapshot — code, database schema, migrations,
tests, and legal-page references. What's being sold here is the B2B
product only.

## Suggested starting point for discussion

No revenue to multiply, so this isn't priced off ARR. Any asking price is a seller decision, not a verified market valuation.
The historical valuation report is dated 2026-10-12 and must be refreshed
before relying on its figures or presenting them as current.

## Full due-diligence package

`ARCHITECTURE.md`, `FEATURE_INVENTORY.md`, `SECURITY_DUE_DILIGENCE.md`,
`TEST_QUALITY_REPORT.md`, `ENVIRONMENT.md`, `DEPLOYMENT_GUIDE.md`,
`TRANSFER_GUIDE.md`, `SALE_ASSET_CHECKLIST.md`, and
`BUYER_DUE_DILIGENCE.md` — all in this `docs/transfer/` directory.
