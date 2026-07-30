# CompanyOS — Sprint 0

Production-ready foundation for an AI-native, multi-tenant B2B SaaS. This is
the platform substrate — auth, tenancy, RBAC, audit, events, jobs, and the AI
runtime — that every future feature sprint builds on top of. It intentionally
ships no vertical product features yet.

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack, React 19) |
| Language | TypeScript, `strict` |
| Database | PostgreSQL + pgvector, via Prisma 7 (driver adapters) |
| Auth | Better Auth (email/password, organizations, RBAC, dynamic roles) |
| Styling | Tailwind CSS v4 + shadcn/ui (Radix primitives) |
| Cache / queues / pub-sub | Redis (ioredis + BullMQ) |
| AI providers | OpenAI, Anthropic, Google Gemini — behind one interface |
| Logging | pino, structured JSON, redacted secrets |
| Containers | Docker (multi-stage web + worker images), docker-compose |

## Architecture

```
src/
  app/                      Next.js routes (App Router)
    (auth)/                 login, register
    (dashboard)/            authenticated app shell: overview, chat, members, audit log, settings
    organizations/          workspace picker / creation
    accept-invitation/      invite acceptance flow
    api/auth/[...all]       Better Auth handler
    api/ai/chat             AI Runtime HTTP entrypoint
    api/health              liveness/readiness probe
  proxy.ts                  Next 16 "proxy" (formerly middleware): optimistic auth gate
  env.ts                    zod-validated environment access (the only file that reads process.env)
  server/
    auth/                   Better Auth server config, RBAC statements/roles, session helpers
    db/                     Prisma client singleton + tenant-scoped client extension
    redis/                  ioredis singleton + BullMQ connection factory
    rate-limit/             Redis fixed-window limiter
    events/                 typed event bus (transactional outbox + Redis pub/sub)
    audit/                  immutable audit log service
    jobs/                   BullMQ queue, worker entrypoint, processors
    logger/                 pino structured logger
    ai/
      providers/            AIProvider interface + OpenAI/Anthropic/Gemini adapters + registry
      runtime/               conversation orchestration loop (tool calling, streaming)
      tools/                 tool registry, RBAC-checked executor, built-in tools
      memory/                short-term (conversation history) + long-term (pgvector) memory
```

### Multi-tenancy

Every tenant-owned table carries `organizationId`. `getTenantScopedClient(organizationId)`
(`src/server/db/tenant.ts`) wraps Prisma with a client extension that injects
`organizationId` into every query against those tables and throws on any
attempt to cross tenants — defense in depth on top of explicit filtering in
application code.

### RBAC

Statements live in `src/server/auth/permissions.ts` and extend Better Auth's
organization statements with app resources (`billing`, `apiKey`, `auditLog`,
`aiConversation`, `aiTool`). Four default roles ship (`owner`, `admin`,
`member`, `viewer`); Better Auth's `dynamicAccessControl` is enabled so
organizations can also define their own custom roles at runtime.

### Audit log

`recordAuditLog` (`src/server/audit/audit-log.ts`) writes an append-only row
per state-changing action and publishes an event. Nothing in the app updates
or deletes audit rows.

### Event bus

`publishEvent`/`subscribeEvent` (`src/server/events/event-bus.ts`) implement a
transactional outbox: every event is durably written to Postgres first, then
best-effort published to Redis. A recurring job (`relay-outbox-events`)
replays anything that didn't make it to Redis, so a Redis blip never drops an
event.

### AI Runtime

`runConversationTurn` / `streamConversationTurn`
(`src/server/ai/runtime/runtime.ts`) assemble context (recent messages +
relevant long-term memory), call the resolved `AIProvider`, and loop through
tool calls via the RBAC-checked Tool Engine (`src/server/ai/tools`) until the
model returns a final answer. Long-term memory is stored as pgvector
embeddings and queried by cosine distance (`src/server/ai/memory/long-term.ts`).

### Background jobs

`src/server/jobs/worker.ts` is a separate process (own Docker image, own
`docker-compose` service) that consumes the BullMQ queue, bridges select
domain events to retryable jobs (e.g. invitation emails), and keeps the
outbox-relay job scheduled.

## Getting started

```bash
cp .env.example .env          # fill in BETTER_AUTH_SECRET and at least one AI provider key
docker compose up -d postgres redis
npm install
npm run db:migrate            # creates the initial migration against your local Postgres
npm run dev                   # web app on http://localhost:3000
npm run worker                # background worker, in a second terminal
```

`BETTER_AUTH_SECRET` must be a random string ≥32 characters
(`openssl rand -base64 32`). Every environment variable is validated eagerly
at startup by `src/env.ts` — missing or malformed config fails fast with a
clear error instead of misbehaving at runtime.

## Deployment

`docker-compose.yml` defines four services: `postgres` (pgvector image),
`redis`, `app` (the Next.js server, built via the Dockerfile's `runner`
stage, `output: standalone`), and `worker` (the Dockerfile's `worker` stage).
Build and run:

```bash
docker compose up -d --build
```

The `app` service exposes `/api/health`, which checks both Postgres and
Redis connectivity — wire it into your orchestrator's health checks.

## Testing what's here

```bash
npm run type-check   # tsc --noEmit
npm run lint          # eslint
npm run build         # next build (Turbopack, production)
```
