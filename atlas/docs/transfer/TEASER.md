# CEVORYN — AI Chief of Staff for Small Teams

**Asset sale.** Full codebase, domain, and brand. Pre-revenue, private beta.
This teaser is deliberately plain about that — no revenue multiple, no
customer-count claim. What's for sale is a working, tested, secured
product, not a customer base.

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

- 307 automated tests, CI-gated on every PR (GitHub Actions)
- TypeScript strict mode, zero `tsc`/lint errors
- Security review covering auth, RBAC, tenant isolation, secrets
  handling, webhook signature verification, rate limiting, input
  validation (zod on all mutating routes), and CSRF/cross-origin
  protection — see `SECURITY_DUE_DILIGENCE.md`
- CodeQL + Dependabot enabled on the repository; findings fixed, not
  deferred
- Non-squashed git history — the actual development process is visible,
  not a single snapshot commit

## Honest current state

- **Zero customers, zero revenue.** This is a pre-release product in
  private beta, not a business with traction. See
  `BUYER_DUE_DILIGENCE.md` for the full, unhedged disclosure.
- No automated browser/E2E test suite (unit + integration only).
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

No revenue to multiply, so this isn't priced off ARR. A reasonable
starting range, grounded in engineering cost-to-rebuild at a steep
pre-revenue/no-traction discount, is **$15,000–$25,000** — set by the
seller, not a platform-generated valuation. Open to offers.

## Full due-diligence package

`ARCHITECTURE.md`, `FEATURE_INVENTORY.md`, `SECURITY_DUE_DILIGENCE.md`,
`TEST_QUALITY_REPORT.md`, `ENVIRONMENT.md`, `DEPLOYMENT_GUIDE.md`,
`TRANSFER_GUIDE.md`, `SALE_ASSET_CHECKLIST.md`, and
`BUYER_DUE_DILIGENCE.md` — all in this `docs/transfer/` directory.
