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
      planner/               LLM-backed multi-step plan generation
      approval/              risk policy + human-approval service for gated tool calls
      agent/                 multi-step run executor: plans, executes, halts, pauses, resumes
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
outbox-relay and task-reminder-sweep jobs scheduled.

### CRM domain (Companies, Contacts, Leads, Tasks)

```
src/server/companies/    Company CRUD — organization-scoped, soft delete, audit log
src/server/contacts/     Contact CRUD, company relation, tags, notes
src/server/leads/        Pipeline stages, Lead CRUD, activity timeline
  pipeline.ts             default stage seeding + custom stage creation
  analysis.ts             deterministic, LLM-free lead risk analysis
src/server/tasks/        Task CRUD — assignee, due date, priority, status
  reminders.ts             due-reminder sweep (emails the assignee once)
```

Every write goes through a domain service function, never a raw Prisma call
from a Server Action or route handler. Each service function runs inside a
`prisma.$transaction` alongside its `recordAuditLog(input, tx)` call so the
mutation and its audit entry commit atomically; the outbox event publish
happens after the transaction commits (`publishAuditEvent`). Reads go
through `getTenantScopedClient` for the same defense-in-depth tenant
isolation Sprint 0 established. Cross-entity references (a lead's
`companyId`, a task's `leadId`, an assignee) are validated to belong to the
same organization inside the transaction before the write happens —
`LeadCompanyReferenceError`, `TaskAssigneeReferenceError`, etc.

### AI Sales Employee

Five tools, registered in `src/server/ai/tools/builtin/` exactly like
Sprint 0's tools (no changes to the Tool Engine itself): `get_lead`,
`analyze_lead`, `search_leads`, `create_task`, `record_lead_activity`. Each
declares a `requiredPermission` that the existing RBAC check enforces, and
each handler calls only the CRM service layer — the AI has no path to the
database that bypasses a tool. Every invocation is written to `AuditLog`
with `actorType: "ai"` and the acting user's id, on top of the
`ToolInvocation` row the Tool Engine already records for every tool call.

`analyze_lead` is backed by a pure, deterministic function
(`src/server/leads/analysis.ts`): days in pipeline, days since last
activity, open/overdue task counts, a risk level, and a rule-based
suggested next action. There is no second LLM call inside the tool — the
model calls it, reads the result, and decides what to do (create a task,
record its analysis on the timeline, or just answer), which keeps the
analysis itself fully unit-testable independent of any AI provider.

### Agent orchestration (Sprint 2)

Sprint 1's AI Sales Employee could use one tool at a time, chosen turn by
turn inside the chat loop. Sprint 2 adds a second, parallel entrypoint —
`/dashboard/agent` — that takes a single natural-language goal and drives it
to completion across multiple tool calls, safely:

```
src/server/ai/planner/    Analyzes a goal into an ordered tool-call plan
src/server/ai/approval/   Risk policy + human-approval service for gated calls
src/server/ai/agent/      Executes a plan step by step, halts, pauses, resumes
```

**Planner.** `createPlan` (`src/server/ai/planner/planner.ts`) hands the
model a synthetic `propose_plan` tool — never added to the real Tool Engine
registry — alongside a text catalog of every real registered tool and its
JSON Schema. The model calls `propose_plan` exactly once with the ordered
steps it wants to take; if it decides no tool call is needed, it proposes an
empty list and the planner falls back to a direct text answer. A plan step
whose `toolName` isn't a real registered tool, or whose shape doesn't match
the `propose_plan` schema (including the hard cap of 8 steps), is rejected
with `PlannerValidationError` before anything runs.

**Multi-tool execution.** `startAgentRun` (`src/server/ai/agent/executor.ts`)
persists the plan as an `AgentRun` with one `AgentStep` row per step, then
executes each step in order through the exact same `executeToolCall` the
chat runtime uses — the model has no path to the database that bypasses the
RBAC-checked Tool Engine. A failing step halts the entire run immediately
(`status: "failed"`); no later step is ever attempted once one has failed,
so a multi-step action can't leave a tenant's data partially applied without
it being visible in the run. Every step transition and the run's own
start/completion/failure are written to `AuditLog` with `actorType: "ai"`,
on top of whatever audit entries the underlying tool handler writes itself.

**Human approval.** `src/server/ai/approval/policy.ts` classifies every tool
as `auto` (read-only lookups and append-only annotations) or
`requires_approval` (secure by default — an unrecognized tool name requires
approval) — currently only `create_task` is gated, since it's the one tool
that assigns real, actionable work to a person. When the executor reaches a
gated step, it opens an `AgentApproval` row and pauses the run
(`status: "waiting_approval"`) instead of calling the tool. `decideApproval`
(`src/server/ai/approval/service.ts`) requires the decider to hold the
*underlying tool's own* `requiredPermission` — there is no separate
"approver" permission, so this reuses Sprint 0's RBAC check exactly rather
than adding new permission surface. Approving resumes the run and executes
the step normally; rejecting marks that one step `"skipped"` and the run
continues with the remaining steps, since a rejection is a valid outcome,
not a system failure.

**LLM integration.** The planner is the only place a model is called during
an agent run, and it never sees real data beyond the tool catalog and the
conversation — every subsequent action goes through `executeToolCall`. Both
the planner and the executor accept a DI'd `provider` (or `providerId`),
so calling code (and tests) can supply any `AIProvider`; the default target
comes from `resolveDefaultTarget()`/`resolveProviderForModel()`, the same
Sprint 0 provider registry the chat runtime resolves against — no new
provider plumbing.

## Getting started

```bash
cp .env.example .env          # fill in BETTER_AUTH_SECRET and at least one AI provider key
docker compose up -d postgres redis
npm install
npm run db:migrate            # applies the committed migrations to your local Postgres
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
npm test              # vitest: integration tests (see below)
npm run build          # next build (Turbopack, production)
```

`npm test` runs real integration tests against Postgres and Redis (started
via `docker compose up -d postgres redis`, or any reachable instance your
`.env` points at) — there is no mocked DB/auth layer. Coverage:

- `tests/auth.test.ts` — sign-up/sign-in, organization creation
- `tests/rbac.test.ts` — permission boundaries across all four roles, including the CRM resources
- `tests/tenant-isolation.test.ts` — `getTenantScopedClient` guarantees
- `tests/tool-engine.test.ts` — the Tool Engine's permission gate and invocation logging
- `tests/audit-log.test.ts` — the audit log service
- `tests/companies.test.ts`, `tests/contacts.test.ts`, `tests/leads.test.ts`, `tests/tasks.test.ts` — CRM domain CRUD, soft delete, cross-tenant reference validation, audit logging
- `tests/lead-analysis.test.ts` — the deterministic `analyzeLead` risk/next-action rules (pure, no DB)
- `tests/ai-sales-employee.test.ts` — the AI tools via `executeToolCall`, including a real RBAC denial (a viewer genuinely can't `create_task`)
- `tests/e2e-scenario.test.ts` — the full acceptance scenario below, driven end to end
- `tests/planner.test.ts` — `createPlan` against a scripted `AIProvider` test double: valid plans, the direct-answer fallback, and every validation-error path (malformed args, unknown tool, over the step cap)
- `tests/approval-policy.test.ts` — the risk classification table, including the secure-by-default fallback for unrecognized tools
- `tests/agent-executor.test.ts` — the full agent run loop against the real Tool Engine: multi-step completion, halt-on-error (a genuine RBAC denial mid-run), pause/approve/resume, pause/reject/continue, and RBAC preserved on the approval decision itself

Each test creates its own users/organizations with random emails and slugs,
so the suite is safe to run repeatedly against the same database.

CI (`.github/workflows/companyos-ci.yml`) runs this exact sequence — plus
`prisma migrate deploy` against fresh Postgres/Redis service containers —
on every push and pull request that touches `companyos/**`.

### The Sprint 1 acceptance scenario

> A company is created → a contact is added → a lead is created → the AI
> Sales Employee analyzes the lead → it creates an appropriate task → every
> step is in the audit log.

`tests/e2e-scenario.test.ts` runs exactly this, asserting the CRM records
are linked correctly, the lead's activity timeline has the right entries,
and the audit log contains every step with the right actor attribution
(`user` for the human-created records, `ai` for the AI's own actions — all
still tied to the human who was in the conversation). It drives the AI step
through `executeToolCall` directly rather than a real model, so it's
deterministic and needs no AI provider key.

To see the same scenario run through an actual model (tool selection and
phrasing included), you need at least one AI provider key configured:

1. Set `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`) in `.env` and start the app (`npm run dev`) and worker (`npm run worker`).
2. Sign up, create a workspace, then create a company, a contact linked to it, and a lead linked to both from the dashboard (`/dashboard/companies`, `/dashboard/contacts`, `/dashboard/leads`).
3. Open `/dashboard/chat` and ask: _"Analyze the lead for \<company name\> and create a follow-up task."_
4. The assistant should call `analyze_lead`, then `create_task` (and typically `record_lead_activity`) — visible as new rows on the lead's detail page (`/dashboard/leads/[id]`): a new task, a new `ai_analysis` timeline entry.
5. Confirm the trail on `/dashboard/audit-log`: `lead.ai_analyzed`, `task.created`, and `lead.ai_activity_recorded` entries with the AI's actions attributed to your user id.
