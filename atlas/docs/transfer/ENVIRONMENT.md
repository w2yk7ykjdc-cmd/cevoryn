# Environment Variables

Variable **names only** — no real values are included in this document.
Source of truth for what's actually validated at boot: `src/lib/env.ts`
(zod schemas). This list also includes variables referenced elsewhere in
the codebase that are not covered by that schema (Google integration,
cron auth, Vercel-provided variables).

Copy `.env.example` to `.env.local` and fill in real values for local
development. In production, set these in Vercel's Environment Variables
UI (Project → Settings → Environment Variables).

## Required — app will not boot / core features will not work without these

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Prisma's runtime Postgres connection (pooled, e.g. Supabase's transaction pooler) |
| `DIRECT_URL` | Prisma's direct (non-pooled) Postgres connection, needed to run migrations |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL, used by both server and browser Supabase clients |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public API key (safe to expose to the browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase key with elevated privileges (used for admin-level operations; never expose to the client) |
| `OPENAI_API_KEY` | Authenticates all chat/AI calls to OpenAI |
| `NEXT_PUBLIC_APP_URL` | Canonical app URL — used to build redirect/callback URLs (auth, Google OAuth) and CSRF origin checks |

## Required for specific features (feature is disabled/errors without them)

| Variable | Feature | Notes |
|---|---|---|
| `POLAR_ACCESS_TOKEN` | Billing | Polar organization API access token |
| `POLAR_WEBHOOK_SECRET` | Billing | Verifies Polar's webhook signature (`webhook-signature` header) |
| `POLAR_PRODUCT_STARTER` | Billing | Polar product ID for the Starter plan |
| `POLAR_PRODUCT_PROFESSIONAL` | Billing | Polar product ID for the Professional plan |
| `POLAR_PRODUCT_BUSINESS` | Billing | Polar product ID for the Business plan |
| `POLAR_ENV` | Billing | `sandbox` or `production` — selects which Polar API base URL is used |
| `GOOGLE_CLIENT_ID` | Google Calendar/Gmail integration | OAuth client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Google Calendar/Gmail integration | OAuth client secret |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Google Calendar/Gmail integration | Symmetric key (min 32 chars) used to encrypt stored Google OAuth tokens at rest |
| `CRON_SECRET` | Scheduled jobs + health endpoints | Bearer token Vercel Cron sends on scheduled requests; also gates `/api/health/database` and `/api/health/runtime` |
| `RESEND_API_KEY` | Team invite emails | Must be set together with `EMAIL_FROM` — boot-time validation rejects one without the other |
| `EMAIL_FROM` | Team invite emails | Sender address for invite emails |

Note: `POLAR_*` and `GOOGLE_*` are each validated as **all-or-nothing
groups** at boot (`validateServerEnv()` in `src/lib/env.ts`) — if any one
variable in a group is set, all of that group's variables must be set, or
boot fails with a clear error naming the missing ones. Leaving an entire
group fully unset simply disables that feature (billing or Google
integration) without breaking boot.

## Optional

| Variable | Used for | Default if unset |
|---|---|---|
| `OPENAI_MODEL` | Which OpenAI model powers chat | `gpt-4o-mini` |
| `OPENAI_MAX_TOKENS` | Max output tokens per AI response | `2048` |
| `DAILY_TOKEN_LIMIT_PER_ORG` | Per-organization daily AI token budget (abuse/cost control) | `500000` |
| `NEXT_PUBLIC_APP_NAME` | Display name used in a few UI strings | `CEVORYN` |
| `NEXT_PUBLIC_ENABLE_AI` | Feature flag for AI features | `true` |
| `NEXT_PUBLIC_SENTRY_DSN` | Enables Sentry error reporting (client + server) | unset = Sentry calls are a no-op |
| `NODE_ENV` | Standard Node environment flag | `development` |

## Provided automatically — do not set manually

These are populated by the hosting/CI platform itself, not by a person:

| Variable | Source |
|---|---|
| `VERCEL_ENV`, `NEXT_PUBLIC_VERCEL_ENV` | Vercel (`production`/`preview`/`development`) |
| `VERCEL_URL` | Vercel (the deployment's own `*.vercel.app` URL) |
| `VERCEL_PROJECT_PRODUCTION_URL` | Vercel (fallback used to build the Google OAuth redirect URI if `NEXT_PUBLIC_APP_URL` is unset) |
| `VERCEL_GIT_COMMIT_SHA` | Vercel (used for Sentry release tagging) |
| `CI` | GitHub Actions |
| `NEXT_RUNTIME` | Next.js itself (`nodejs` / `edge`) |

## Not currently used but worth knowing about

- **Sentry source-map upload** (`@sentry/nextjs`'s build-time plugin, wired
  in `next.config.ts`) normally wants a `SENTRY_AUTH_TOKEN` for uploading
  source maps during build. No such variable exists anywhere in this
  codebase or CI config — source-map upload is not currently wired up.
  This does not block the build (the plugin silently skips upload without
  a token) but means Sentry stack traces in production are unminified/less
  readable until this is set up. Not a blocker for transfer, but worth
  the new owner's attention if they rely on Sentry for debugging.
