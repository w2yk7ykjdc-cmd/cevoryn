# Buyer Due-Diligence

Honest disclosure document. Anything not directly verifiable from the
repository or this session's own production-testing history is marked
**UNKNOWN**, not estimated.

## Current status

- The public website and app entry routes are reachable, but this does not
  by itself prove that the current production deployment is serving the
  latest `main` commit or that all authenticated workflows work.
- The latest verified post-merge main CI run is
  [run 38004848100](https://github.com/w2yk7ykjdc-cmd/cevoryn/actions/runs/38004848100),
  which passed after PR #269. CI is evidence of the tested commit, not of
  live production deployment or third-party service configuration.
- The repository contains prior internal verification reports for type
  checking, lint, formatting, tests, and production build. Do not repeat
  historical test counts as a fresh run without checking the corresponding
  report and current workflow.
- Google Calendar/Gmail and Polar checkout/cancellation have historical
  owner-reported end-to-end tests. They were not independently re-run in
  this review. The current deployed Polar checkout, webhook, entitlement,
  and cancellation path must be re-verified before making a buyer-facing
  claim that billing is currently operational.

## Revenue

**UNKNOWN.** This documentation pass has no access to the Polar dashboard
or any billing export. Prior project notes report at least one real subscription checkout and
one cancellation completed end-to-end, but this documentation pass did not
independently verify those transactions against the current Polar
dashboard or production database. No aggregate revenue figure, MRR, or
transaction count can be stated. Treat current billing status as requiring
live re-verification before buyer representations.

## Users

**UNKNOWN — total/active user counts.** This documentation pass has no
live query access to the production database. What's confirmed from the
codebase's own design assumptions: the system prompt explicitly documents
that the primary/founder organization is currently a one-person
organization (`src/features/ai/context/prompts.ts`), and at least one
paying user (the founder's own account) is confirmed via the real
checkout test above.

## Dependencies / third-party services

| Service | Role | Required? |
|---|---|---|
| Supabase | Database + Auth | Required |
| OpenAI | AI/chat provider | Required |
| Vercel | Hosting, cron, domain | Required |
| Polar.sh | Billing | Required for monetization (app runs without it, billing routes just error) |
| Google Cloud (OAuth) | Calendar/Gmail integration | Optional feature, not required for core app |
| Sentry | Error tracking | Optional |
| Resend | Invite emails | Optional (falls back to copy-link) |

None of these are exclusive/locked-in beyond normal SaaS vendor
switching costs — see [`TRANSFER_GUIDE.md`](TRANSFER_GUIDE.md) for how to
move each one to the buyer's own accounts.

## Known limitations

- **No automatic database backups.** Supabase's free tier (which this
  project currently runs on, per prior internal documentation — not
  independently re-verified live in this pass) does not include automatic
  backups. Upgrading to a paid Supabase tier is recommended before/at the
  point of any real customer data volume growing.
- **AI model is cost-optimized, not top-tier.** `OPENAI_MODEL` defaults to
  `gpt-4o-mini`. This is configurable via environment variable but the
  default choice trades some response quality/instruction-following
  strictness for lower per-call cost.
- **Polar's exact webhook redelivery window is not officially documented**
  by Polar; the app's own cleanup job uses a conservative 30-day retention
  window for webhook-idempotency records as a safety margin, not a number
  confirmed against Polar's actual SLA.
- **No automated E2E/browser test suite** — only unit and integration
  (real-database) tests exist. UI regressions are not caught by CI.
- **Vercel cron operations** — `atlas/vercel.json` currently defines four
  daily cron jobs. Current Hobby restrictions concern per-cron frequency
  (no more than once per day), not a two-job total. Vercel does not
  automatically retry failed cron invocations; production execution logs
  must be checked directly.
- **English-only UI as of this session's most recent change** — Turkish
  UI infrastructure is intentionally retained (not deleted) for possible
  future re-activation, but is not currently active.

## Assets to be transferred

- Full source code and complete git commit history (not a squashed
  snapshot) — see [`SALE_ASSET_CHECKLIST.md`](SALE_ASSET_CHECKLIST.md).
- `cevoryn.com` / `www.cevoryn.com` domain (registered and managed via
  Vercel).
- Brand assets: logo, favicon, OG image, in-app branding (`src/lib/brand.ts`
  and `public/` assets).
- Production database contents (organizations, users' Supabase Auth
  accounts, all app data) — transfers with the Supabase project.
- This documentation set.

## Accounts / credentials that do NOT transfer automatically and must be re-provisioned by the buyer

- OpenAI API key (must be the buyer's own — see `TRANSFER_GUIDE.md` §5).
- Google Cloud OAuth client credentials (transfer or recreate — §6).
- Polar organization and its billing/webhook credentials (§7) — and note
  again: existing Polar subscribers do not automatically follow a Polar
  organization transfer without Polar's own involvement.
- Sentry project (if wanted).
- Resend account (if wanted).
- `GOOGLE_TOKEN_ENCRYPTION_KEY` and `SUPABASE_SERVICE_ROLE_KEY` should be
  rotated post-sale as standard security practice, even where the
  underlying account itself is transferred rather than recreated.
