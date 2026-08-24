# CEVORYN

AI Chief of Staff for companies with 2–20 employees. CEVORYN gives small
teams a single AI-driven workspace for company-context chat, a daily
briefing, a company-health score, and an AI-assisted decision/insight
pipeline — plus real Google Calendar/Gmail actions the AI can take on the
user's behalf, and Polar-backed subscription billing.

This README is the top-level orientation document. For a deeper technical
handover (setup checklist, environment variables, architecture, feature
inventory, security review, deployment, and buyer due-diligence), see
[`docs/transfer/`](docs/transfer/).

## Product overview

- **Chat** — an AI conversation grounded in the organization's own stored
  memories, insights, decisions, and (if connected) live Gmail/Calendar
  signals. Not a generic chatbot: the system prompt explicitly instructs
  the model to ground every answer in organization-specific evidence and
  say so when evidence is insufficient, rather than improvising.
- **Brief** — an on-demand daily summary of what changed and what needs
  attention.
- **Health / Pulse** — a company-health score computed from real
  conversation/message/memory activity, compared against the previous
  snapshot.
- **Decisions & Insights** — a structured decision-canvas workflow
  (problem → evidence → options → recommendation → outcome tracking) and
  an insight-detection pipeline, both explainable (every recommendation
  carries a confidence score and cited evidence).
- **Prepared Actions** — AI-drafted next steps that a human must
  explicitly approve; nothing executes automatically.
- **Team** — invite-based multi-tenant membership with role-based access
  (`OWNER` / `ADMIN` / `MEMBER`).
- **Google integration** — read Gmail/Calendar signals into chat context,
  and create real Calendar events / Gmail drafts from a natural-language
  chat request (English or Turkish intent phrasing).
- **Billing** — Polar-backed subscription plans (Starter/Professional/
  Business), self-service checkout, plan changes, and cancellation via a
  billing portal.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15.5 (App Router), React 19, TypeScript 5.7 |
| Styling | Tailwind CSS 3.4, shadcn/ui |
| Database | PostgreSQL via Prisma ORM 6.2 (hosted on Supabase) |
| Auth | Supabase Auth (email+password, Google OAuth sign-in) |
| AI provider | OpenAI SDK (default model `gpt-4o-mini`, configurable) |
| Billing | Polar.sh (checkout, portal, webhooks) |
| Integrations | Google Calendar & Gmail (OAuth, token encryption) |
| Error tracking | Sentry |
| i18n | next-intl (English-only active locale; Turkish infra retained, see below) |
| Hosting | Vercel (app, cron jobs, domain) |
| CI | GitHub Actions (typecheck, lint, format, unit + integration tests, build) |

## Local development

```bash
git clone https://github.com/w2yk7ykjdc-cmd/cevoryn.git && cd cevoryn/atlas
npm install
cp .env.example .env.local   # fill in required values, see docs/transfer/ENVIRONMENT.md
npx prisma generate
npx prisma db push           # or: npx prisma migrate deploy, for a migration-tracked DB
npm run dev
```

Useful scripts (see `package.json` for the full list):

```bash
npm run type-check      # tsc --noEmit
npm run lint            # ESLint
npm run format:check    # Prettier check
npm test                # unit tests (node:test)
npm run test:integration  # integration tests against a real Postgres instance
npm run build            # production build
```

## Architecture

```
src/
├── app/                  # Next.js App Router — pages + API routes
│   ├── (auth)/            # Login, signup, password reset
│   ├── (dashboard)/       # Dashboard, brief, health, intelligence, team, settings
│   ├── (chat)/            # Chat route group
│   └── api/               # API routes (see docs/transfer/ARCHITECTURE.md for the full list)
├── components/            # Shared UI (shadcn/ui primitives, layout chrome)
├── features/
│   ├── ai/                 # Chat engine, streaming, providers, Google chat actions
│   ├── auth/                # Auth actions, rate limiting
│   ├── brain/                # Memory, Insights, Pulse, Brief, Decisions, Learning
│   ├── billing/               # Billing UI actions
│   ├── executive/              # Executive-home dashboard composition
│   └── onboarding/
├── i18n/                 # next-intl config (English-only active locale)
├── lib/                  # Auth helpers, RBAC, Prisma client, Google OAuth, constants
├── server/services/      # Cross-cutting business logic (conversations, billing, rate limits)
└── types/
```

For the full API route list, Prisma data model, and module-by-module
architecture notes, see
[`docs/transfer/ARCHITECTURE.md`](docs/transfer/ARCHITECTURE.md).

## Deployment

Production deploys automatically from the `main` branch via Vercel's
GitHub integration. See
[`docs/transfer/DEPLOYMENT_GUIDE.md`](docs/transfer/DEPLOYMENT_GUIDE.md)
for the full procedure, including database migrations and required
third-party setup steps.

## Testing

- **Unit tests** (`npm test`) — pure-function and component-logic tests,
  no external dependencies.
- **Integration tests** (`npm run test:integration`) — run against a real
  Postgres instance (a service container in CI).
- **CI** (`.github/workflows/ci.yml`) — runs on every push/PR to `main`:
  Prisma schema validation, type-check, lint, format check, unit tests,
  integration tests (against a real Postgres service container), and a
  production build. See
  [`docs/transfer/TEST_QUALITY_REPORT.md`](docs/transfer/TEST_QUALITY_REPORT.md)
  for the latest verified results.

## Monitoring

Sentry captures server-side and client-side errors when
`NEXT_PUBLIC_SENTRY_DSN` is configured (a no-op otherwise). Two
authenticated health endpoints (`/api/health/database`,
`/api/health/runtime`, both gated behind `CRON_SECRET`) report database
connectivity and runtime status for external uptime monitoring.

## Known limitations

See [`docs/transfer/BUYER_DUE_DILIGENCE.md`](docs/transfer/BUYER_DUE_DILIGENCE.md)
for the full, current list. Headline items: Supabase's free tier has no
automatic database backups; the AI model is a cost-optimized default
(`gpt-4o-mini`) rather than a top-tier model; Polar's exact webhook
redelivery window is not officially documented (a conservative internal
retention window is used instead); active/registered user counts and
revenue figures require direct access to the Supabase/Polar dashboards,
which this documentation pass did not have.

## License

Proprietary. All rights reserved.
