# Stage 0 — Repository Audit (for Romance Engine integration)

Scope: not a full re-audit of Cevoryn (one was done exhaustively earlier
this session by 5 parallel read-only agents covering Core
Architecture/Data Model, Brain, Radar/Signal Coverage, Proprietary
Data/Enterprise, Security/Production Readiness — every finding below was
either produced by that audit or independently re-verified by reading the
actual file in this pass). This document is scoped to one question: **what
does Romance Engine reuse, and where does it attach?**

## 1. Stack (verified)

- Next.js 15 (App Router, Turbopack dev), React, TypeScript strict.
- Prisma 6.19.3 ORM over PostgreSQL (Supabase-hosted in production).
- Supabase Auth (`@supabase/ssr`) for authentication — cookie-based session
  in middleware (fast path), network-verified `auth.getUser()` in
  `src/lib/auth.ts::getUser()` (the real security boundary).
- Polar for B2B billing (`src/server/services/billing.service.ts`, raw-SQL
  managed tables per `schema.prisma`'s own comment on `Subscription`).
- OpenAI today, behind a provider interface (`src/features/ai/providers`)
  — `AIProvider` (`name`, `streamCompletion()`, `complete()`), factory
  `getAIProvider()`. No Anthropic/Gemini implementation yet, but the seam
  is real and already used by every AI call site in the codebase.
- Sentry (`@sentry/nextjs`) wired for all 3 runtimes (node/edge/browser),
  plus fail-fast env validation (`src/lib/env.ts`,
  `validateServerEnv`/`validateClientEnv`, called from
  `src/instrumentation.ts` at boot).
- Vercel hosting + cron (`vercel.json`), GitHub Actions CI
  (`.github/workflows/ci.yml`): Prisma validate → destructive-migration
  scan → typecheck → lint → prettier → unit tests → integration tests
  (real Postgres service container) → build.
- Tests: 39 unit test files (`atlas/test/*.test.ts`, `node:test`, no
  framework dependency), 17 real-Postgres integration test files
  (`atlas/test/integration/*.integration.ts`) — each independently guards
  against running against a `supabase.co`-shaped host.

## 2. Tenancy / Auth (verified — see ADR-0001 for the decision this drives)

- `Organization` → `Member` (`userId` + `organizationId` unique pair,
  roles OWNER/ADMIN/MEMBER) is the *only* existing tenancy model, and it is
  B2B-shaped: onboarding forces every new user to name an "organization"
  before reaching the dashboard; `maxOrganizations: 1` on every plan.
- `getUser()` (network-verified Supabase session) is the real auth
  boundary; `getMembership(userId)` resolves the Organization. Romance
  needs the former, not the latter (ADR-0001).
- Multi-tenancy discipline is real and consistently enforced: every
  service file scopes Prisma queries by `organizationId`; a prior audit
  grep for a bare `where: { id }` anti-pattern across
  `src/features/**/*.service.ts` found zero matches.

## 3. AI infrastructure (verified, directly reusable)

- `AIProvider` interface (`src/features/ai/providers/types.ts`) is already
  streaming-capable, model-agnostic, and has zero Organization coupling.
  Romance's Scene Generation step calls this exact interface — no new AI
  abstraction needed.
- Established, repo-wide convention: split **pure, testable math/logic**
  (no `"server-only"`, no Prisma, no AI call — e.g.
  `opportunity-generation-math.ts`, `decision-scorer.ts`,
  `event-extraction-math.ts`) from the **server-only orchestration**
  wrapper that calls the DB/AI and uses the pure function. 8 existing
  `*-math.ts` files follow this. **Romance's Intent Parser, Canon
  Validator, and State Transition engine must follow the same split** —
  this is the single most important structural convention to inherit,
  because it is what makes deterministic story logic unit-testable
  without an AI provider credential (exactly the discipline this session's
  own integration-test suite already depends on).
- `SearchProvider<T>` abstraction (`src/lib/search/search-provider.ts`):
  keyword (ILIKE) today, explicitly designed so a future
  `SemanticSearchProvider` (embeddings) can be swapped in per call site
  without changing the caller. Romance's Memory retrieval should use this
  same seam rather than inventing a new one.

## 4. Memory precedent (verified, conceptually reusable — not the same table)

- Cevoryn's existing `Memory` model (`brain` domain) is **already typed,
  not raw chat history**: `category` enum, `source` (MANUAL/EXTRACTED),
  `confidence`, `isActive`, extracted by a pure
  `memory-extraction-math.ts`. This is the right shape to generalize for
  Romance's much richer memory taxonomy (PROMISE/BARGAIN/DEBT/SECRET/...)
  — a new, Romance-specific model (`RomanceMemory`), not a retrofit of the
  existing one (different domain, different retention/contradiction rules,
  per ADR-0001's "new table, not a shared one" principle).

## 5. Patterns worth inheriting directly

- **Optimistic-concurrency state transitions**: `decision.service.ts`'s
  `VALID_SOURCE_STATUSES` map + `updateMany({ where: { status: {in:...} }
  })` (added this session to close a real FSM gap) is the exact technique
  Romance's Beat/Relationship state transitions need — validated, and
  there is now a real regression test
  (`decision-status-fsm.integration.ts`) demonstrating the pattern.
- **Idempotent side-effect recording**: `opportunity.service.ts`'s
  `updateOpportunityStatus()` (checks-then-creates one `OutcomeEvaluation`
  row per transition) is the model for Romance's Audio render idempotency
  (never double-render the same scene).
- **Postgres advisory-lock rate limiting**:
  `auth-rate-limit.service.ts::tryRecord()` closes a real TOCTOU race
  under READ COMMITTED via `pg_advisory_xact_lock`. Romance action-rate
  limiting (prevent spamming free-form input to burn AI tokens) reuses
  this exact technique.
- **Destructive-migration CI gate**: real, proven (it exists because of a
  real production incident — see `schema.prisma`'s own comment on
  `GoogleConnection`). Romance's schema migrations are additive-only by
  the same gate, with zero exceptions needed.

## 6. Where Romance attaches

| Layer | New | Reused as-is |
|---|---|---|
| Auth | — | `getUser()` / Supabase Auth |
| Tenancy root | `RomancePlayer` (keyed by `userId`) | — |
| Route group | `src/app/(romance)/**` | — |
| Feature code | `src/features/romance/**` | `AIProvider`, `SearchProvider<T>` |
| DB | New Prisma models, additive migration | Same Postgres instance, same migration tooling |
| Entitlement | `RomanceSubscription` (FREE/PREMIUM) | — |
| Audit | `RomanceAuditLog` | Same `recordAuditEvent`-shaped pattern, new table |
| Rate limiting | New limiter rows | `tryRecord()`'s advisory-lock technique |
| Observability | — | Sentry, `captureServerError`, structured `console` prefix convention |
| CI | New test files only | Same `ci.yml` pipeline, same destructive-migration gate |

## 7. Explicitly NOT touched

Zero existing files under `src/features/{radar,brain,enterprise,billing,
auth,team,executive,onboarding}` or `src/app/(dashboard)` are modified by
Romance work. Zero existing Prisma models are altered. The B2B product
continues to build, test, and deploy exactly as it does today.
