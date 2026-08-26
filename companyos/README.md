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
    api/billing/webhook     Stripe inbound webhook receiver
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
    billing/
      provider/              PaymentProvider interface + Stripe adapter + registry
      plans.ts               plan catalog (free/pro/enterprise), seeded idempotently
      subscription.ts        provisioning, checkout/portal sessions, webhook event application
      usage.ts               usage ledger, current-period aggregation, limit enforcement
      rollover.ts            advances free-tier billing periods once they've ended
    api-keys/                create/list/revoke/verify + short-lived session minting for programmatic auth
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
or deletes audit rows. `/dashboard/audit-log` filters by action, target type,
and date range (the read path, `listAuditLogs`, has always supported this —
the UI just didn't expose it until now); anyone holding the `auditLog:["export"]`
permission (another statement that's existed since Sprint 0 with nothing
behind it) additionally sees an **Export CSV** button, backed by
`GET /api/audit-log/export`, which streams the filtered set as CSV — capped
at 10,000 rows, since an org with more history than that needs a real
reporting pipeline, not a browser download. The export itself is written
back to the audit log (`audit_log.exported`), since knowing who pulled a
copy of the compliance record is part of the record.

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

The chat UI (`/dashboard/chat`) drives `streamConversationTurn` through
`POST /api/ai/chat` with `stream: true`: the route resolves any tool calls
server-side first (silently, non-streamed — the model's tool-selection
reasoning isn't shown token by token), then streams the final answer as an
SSE response of `StreamEvent`s (`text_delta`, `error`, plus a leading
`conversation` event carrying the conversation id for a fresh chat). The
non-streaming JSON response (`stream: false`, the default) still exists for
callers that just want the finished answer in one round trip. Both paths
share the same pre-flight `checkUsageLimit` and post-call `recordUsage`
calls, so a maxed-out organization is stopped before either ever resolves a
model — see "Billing & usage metering" below.

**Conversation history.** `/dashboard/chat` has a sidebar listing an
organization member's own past conversations (`listConversations`,
`src/server/ai/runtime/conversations.ts` — defined since Sprint 0 but never
actually called until now), each labeled by its explicit `title` if one was
set (agent runs do this; regular chat never has) or else a snippet of its
first user message. Clicking one loads its history
(`getConversationMessages`, filtered to user/assistant messages — the
model-facing `getConversationHistory` in `memory/short-term.ts` is a
different function, meant to feed the provider, not a chat bubble list) via
a `?conversation=<id>` URL param, so a reload keeps you where you were.
Deleting a conversation (`archiveConversation`) soft-deletes it via
`archivedAt`, the same pattern the CRM domain's `deletedAt` uses, gated by
the `aiConversation:["delete"]` permission — also declared since Sprint 0
and, like `apiKey` and `auditLog:["export"]` before it, never wired to
anything until now.

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
the `propose_plan` schema (including the hard cap of 8 steps), triggers one
corrective retry — the validation error is fed back to the model as the
`propose_plan` call's tool result, asking it to call `propose_plan` again
with corrected arguments — before giving up with `PlannerValidationError`.
`Plan.usage` sums token usage across both attempts, so a retry is still
metered accurately.

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

### Billing & usage metering (Sprint 3)

Every organization has exactly one `Subscription`, provisioned onto the
free plan the moment it's created (`provisionDefaultSubscription`, hooked
into the same `afterCreateOrganization` callback Sprint 1 used for
pipeline seeding). The plan catalog (`src/server/billing/plans.ts`) is
free/pro/enterprise, defined in code and seeded idempotently at read time
— no separate seed script needed in CI.

**Payments.** `src/server/billing/provider` mirrors the `AIProvider`
pattern from Sprint 0: a `PaymentProvider` interface with a Stripe adapter
behind it, resolved through a registry that throws a clear error if
`STRIPE_SECRET_KEY` isn't set rather than crashing at boot — billing is
opt-in per environment, same as an AI provider key. Checkout and billing
portal sessions, and inbound webhook processing
(`POST /api/billing/webhook`), all go through this interface, so tests
exercise the billing business logic against an injected fake provider
instead of real Stripe. Webhook events are idempotent: the event's own
Stripe id is the primary key of `BillingWebhookEvent`, so a redelivery is
caught as a unique-constraint violation and safely ignored.

**Usage metering.** `src/server/billing/usage.ts` records AI token
consumption (from both the chat runtime and the agent planner) and agent
run counts to an append-only `UsageRecord` ledger; current-period usage is
computed on read by summing rows within the subscription's
`[currentPeriodStart, currentPeriodEnd)` window rather than maintaining a
running counter that could drift. `checkUsageLimit` runs *before* the
expensive work starts — at the top of `runConversationTurn` and
`startAgentRun`, before any model is even resolved — so a maxed-out
organization is stopped without spending a token, the same
halt-before-doing-more-damage principle Sprint 2 uses for tool failures.
Exceeding a limit surfaces as `UsageLimitExceededError` (429 from
`/api/ai/chat`, a friendly message from the agent's Server Action). A free
plan's billing period has no Stripe-driven renewal, so a scheduled job
(`roll-billing-periods`, hourly) advances it once it ends; paid
subscriptions are left alone since Stripe's own `customer.subscription.updated`
webhook keeps their period current.

### API keys

The `ApiKey` model (and its `apiKey: ["create", "read", "revoke"]` RBAC
statement) has existed since Sprint 0, but until now nothing used it. This
sprint wires it up end to end: `/dashboard/settings/api-keys` lets anyone
with the `apiKey` permission create, list, and revoke keys for their
organization; `POST /api/ai/chat` accepts them as a second authentication
path alongside the existing session cookie.

**Storage.** `src/server/api-keys/service.ts` generates a `cos_live_`-prefixed
token from 256 bits of random entropy and stores only its SHA-256 hash
(`ApiKey.keyHash`, unique) plus a short `keyPrefix` for safe display — a
fast, non-adaptive hash is the right tradeoff here precisely because the
input is already high-entropy, unlike a human-chosen password. The plaintext
key is returned exactly once, at creation time, and never persisted or
retrievable again; the settings UI makes that explicit with a one-time
"copy now" dialog.

**Authentication without touching RBAC.** The Tool Engine's `executeToolCall`
authorizes every tool call with `auth.api.hasPermission({ headers, ... })`
against a real Better Auth session — an arbitrary bearer string can't
satisfy that. Rather than special-case API keys through the RBAC layer,
`mintSessionForApiKey` mints a genuine, short-lived (5 minute) `Session` row
for the key's creator, scoped to the key's organization, the moment a key
verifies successfully; `/api/ai/chat`'s `resolveCaller` then uses that
session's token as the `Authorization: Bearer` header for the rest of the
request, so every downstream permission check — including each tool call's
own — runs through the exact same path a logged-in user's request would.
No changes to Sprint 0–2's RBAC or Tool Engine internals were needed. One
consequence falls out for free: an API key's effective permissions always
track its creator's *current* role, not a snapshot from when the key was
made — if they're later demoted, so is the key.

**Scopes.** Keys additionally carry a scope list (currently just `ai:chat`,
`src/server/api-keys/types.ts`); a key missing the scope a route requires
is rejected with 403 before a session is ever minted, independent of what
its creator's role would otherwise allow.

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
- `tests/memory-tools.test.ts` — RBAC and argument validation for `remember_fact`/`search_memory`, verified to run (and fail closed) entirely before either ever reaches the embedding provider, so no AI provider key is needed
- `tests/audit-log.test.ts` — the audit log service
- `tests/companies.test.ts`, `tests/contacts.test.ts`, `tests/leads.test.ts`, `tests/tasks.test.ts` — CRM domain CRUD, soft delete, cross-tenant reference validation, audit logging
- `tests/lead-analysis.test.ts` — the deterministic `analyzeLead` risk/next-action rules (pure, no DB)
- `tests/ai-sales-employee.test.ts` — the AI tools via `executeToolCall`, including a real RBAC denial (a viewer genuinely can't `create_task`)
- `tests/e2e-scenario.test.ts` — the full acceptance scenario below, driven end to end
- `tests/planner.test.ts` — `createPlan` against a scripted `AIProvider` test double: valid plans, the direct-answer fallback, every validation-error path (malformed args, unknown tool, over the step cap), and the corrective-retry loop (succeeds after one bad response, still fails after two, sums usage across both attempts)
- `tests/approval-policy.test.ts` — the risk classification table, including the secure-by-default fallback for unrecognized tools
- `tests/agent-executor.test.ts` — the full agent run loop against the real Tool Engine: multi-step completion, halt-on-error (a genuine RBAC denial mid-run), pause/approve/resume, pause/reject/continue, and RBAC preserved on the approval decision itself
- `tests/billing-subscription.test.ts` — default provisioning, checkout/portal session creation against a fake `PaymentProvider`, and webhook lifecycle application (`checkout.session.completed`, `customer.subscription.{updated,deleted}`) including idempotency on a redelivered event id
- `tests/billing-usage.test.ts` — the usage ledger, `checkUsageLimit`'s pass/throw boundary, `getUsageSummary`, and billing-period rollover (advances free-tier subscriptions, leaves Stripe-managed ones alone)
- `tests/billing-limit-enforcement.test.ts` — `runConversationTurn`, `streamConversationTurn`, and `startAgentRun` all refuse to start once a plan's limit is exhausted, verified without needing a real AI provider key since the check runs before any of them ever resolves a provider
- `tests/api-keys.test.ts` — key creation (plaintext-once, hash-only persistence), listing, idempotent revocation, `verifyApiKey`'s unknown/revoked/expired rejection and scope filtering, the session-minting mechanism proven to track a key creator's *current* role (an owner's key can `aiConversation:create`, a demoted-to-viewer creator's key can't), and `POST /api/ai/chat`'s bearer-auth path end to end (401 for no/unknown/revoked key, 403 for a key missing the `ai:chat` scope, and a 502 past that point since no AI provider is configured in CI — the same documented boundary the rest of the AI suite hits)
- `tests/audit-log-export.test.ts` — `exportAuditLogsCsv`'s CSV formatting (header row, comma/quote escaping in metadata) and action/targetType/date-range filtering, plus `GET /api/audit-log/export` end to end: 401 unauthenticated, 403 for a viewer (lacks the `export` permission), 200 with the right CSV headers and body for a permitted owner, the export itself landing back in the audit log, and the route's own query-string filters
- `tests/conversation-history.test.ts` — `listConversations`'s title fallback (explicit title vs. a snippet of the first user message) and ordering/archived-exclusion, `getConversationMessages` filtering to user/assistant rows only and rejecting a conversation from another organization, and `archiveConversation` recording the audit entry and rejecting an already-archived or cross-organization conversation

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
