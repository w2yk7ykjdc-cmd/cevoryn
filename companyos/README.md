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
    organizations/           safe organization/account deletion (lifecycle.ts)
    intelligence/
      signals/               CompanySignal ledger: recordSignal(), event subscriber, scanner, detection rules
      health/                Sales Health scoring: computeSalesHealthScore(), snapshot persistence
      opportunity/           Opportunity Engine V1: signal -> opportunity generation, read path
      compute.ts             recurring "compute intelligence" pass: health snapshot + opportunities per org
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
`companyId`, a task's `leadId`/`contactId`/`companyId`, an assignee, a
lead's `ownerId`) are validated to belong to the same organization inside
the transaction before the write happens — `LeadCompanyReferenceError`,
`TaskAssigneeReferenceError`, `LeadOwnerReferenceError`,
`TaskContactReferenceError`, `TaskCompanyReferenceError`, etc. A lead's
owner defaults to whoever created it but can be reassigned (to any org
member — checked the same way) from both the create dialog and the lead
detail page, handing it off to someone else; `Company.domain` — always
accepted by the service layer but missing from both company forms until
now — is likewise editable end to end. A task can also link directly to a
contact or company (not just a lead) from the create dialog — the schema
and service layer supported this since Sprint 1 (`getTask` even preloaded
both relations), but nothing ever set or displayed it; the contact and
company detail pages now show a Tasks card the same way a lead's detail
page already did.

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
instead of real Stripe. `STRIPE_WEBHOOK_SECRET` is checked separately from
`STRIPE_SECRET_KEY` (`isWebhookVerificationConfigured()`) — a deployment
with the secret key set but the webhook secret missing gets a loud 500
"not configured" from the webhook route instead of every event silently
failing signature verification forever. Webhook processing is idempotent
*and* retry-safe: the event's own Stripe id insert into
`BillingWebhookEvent` and its side effects (subscription update, audit
log) run inside one database transaction, so a failure partway through
rolls back the insert too — a Stripe retry is genuinely reprocessed rather
than being mistaken for an already-applied duplicate — while a
concurrent/replayed delivery of an event that *did* fully commit is caught
as a unique-constraint violation and safely ignored.

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

**Enforcement.** Two plan limits the product advertises had nothing behind
them until now: `checkUsageLimit` checked token/agent-run counts but never
`Subscription.status`, and `Plan.seatLimit` was shown on the billing page
but never checked anywhere. Both are enforced now:

- `checkUsageLimit` throws `SubscriptionInactiveError` for a paid
  (`pro`/`enterprise`) subscription whose status isn't `active` or
  `trialing` — a lapsed payment (`past_due`) stops AI/agent usage before
  either ever resolves a provider, same as an exhausted quota. The free
  plan is never gated on status: its `status` only ever reflects "never
  paid" (`active`) or "churned back down from paid" (`canceled`, set by
  `applyWebhookEvent`'s `customer.subscription.deleted` handler), and both
  should keep working like any other free organization.
  `POST /api/ai/chat` returns 402 with a `billingUrl` for this error,
  distinct from the 429 `UsageLimitExceededError` already returns.
- `assertSeatAvailable` (`src/server/billing/seats.ts`) counts active
  `Member` rows plus `pending` `Invitation` rows against
  `plan.seatLimit` (`null` = unlimited) and throws `SeatLimitExceededError`
  once they're equal — `inviteMemberAction` checks this before creating an
  invitation. A downgrade never removes existing members; it only blocks
  *new* invitations once the org is at or over the new, lower limit.
  Two invitations racing for the last seat are serialized by
  `withSeatLimitLock`, a transaction-scoped Postgres advisory lock keyed on
  the organization id (`pg_advisory_xact_lock(hashtext(organizationId))`)
  — the second caller blocks until the first's invitation has already
  committed, so it recounts correctly instead of both passing the check.

### Lifecycle safety (Sprint 4)

Two destructive, whole-tenant-scale actions had no real safety architecture
behind them: deleting an organization, and deleting a user account.

**Organization deletion.** Better Auth's own `/organization/delete`
endpoint accepts nothing but an id — no confirmation, no billing
awareness — so it's disabled outright (`disableOrganizationDeletion: true`
in `auth.ts`). `deleteOrganization` (`src/server/organizations/lifecycle.ts`)
is the sole supported path, wired only through
`deleteOrganizationAction` (owner-only, via `organization:delete`): it
requires the organization's slug typed back exactly, cancels any live
Stripe subscription *immediately* (not the self-service
cancel-at-period-end `cancelSubscriptionForOrg` uses — there's no period
left to honor once the tenant is gone), and only then deletes the
`Organization` row, which cascades to every tenant-scoped model at the
database level. A free-tier organization (no `stripeSubscriptionId`) never
touches Stripe at all; if Stripe cancellation fails, nothing is deleted. A
durable compliance record is written to the `DomainEvent` outbox
afterward, deliberately *not* linked via that table's own `organizationId`
foreign key (keyed `deletedOrganizationId` in the payload instead), so it
survives independently of the organization it describes.

**Cascade correctness.** `Company.createdBy`, `Contact.createdBy`,
`Lead.createdBy`, `Task.createdBy`, `ContactNote.author`,
`Conversation.user`, and `AgentRun.user` were all `onDelete: Cascade` —
deleting a single user (e.g. via the `admin` plugin's `removeUser`) would
have permanently destroyed every company, contact, lead, task, note, and
conversation *that user ever created*, org-wide, bypassing the app's own
`deletedAt` soft-delete convention entirely. All seven now match the
`owner`/`assignee`-style pattern already used elsewhere: `onDelete: SetNull`,
with the FK made nullable (migration
`20260901153747_lifecycle_safety_setnull_createdby`, additive only — no
data is touched). The record stays; only the creator/author/user reference
goes null.

**Account deletion.** Better Auth's `deleteUser` is now enabled, gated by a
`beforeDelete` hook (`assertSafeToDeleteAccount`) that blocks deleting the
sole owner of any organization. Since Better Auth allows the current owner
to promote another member to "owner" via `updateMemberRole` (both then
hold the role simultaneously), "promote a co-owner, then delete your
account" is the supported ownership-transfer path — no new role-transfer
mechanism was needed. A non-owner member can always delete their own
account; thanks to the cascade fix above, doing so never touches the
organization's shared CRM data.

### Company Events & Signal Foundation (Sprint 5)

The first layer of an Autonomous Intelligence system built entirely on top
of existing infrastructure: the transactional-outbox event bus, BullMQ, and
the tenant-scoping Prisma extension are all reused as-is — nothing about
them changed this sprint.

**Company Signal ledger.** `CompanySignal` (`prisma/schema.prisma`) is a
durable, queryable normalization of business events — distinct from the
`DomainEvent` outbox, which is a transport/replay mechanism, not meant for
long-term analytical queries. Every signal carries `severity` (how bad, a
property of the finding) separately from `confidence` (how sure the
detection is, a property of the data), a `ruleName`/`ruleVersion` pair so
future detection logic can evolve without reinterpreting historical rows,
and a soft `relatedEntityType`/`relatedEntityId` reference — deliberately
not a real Prisma relation, so no existing CRM model needed a back-relation
added. `src/server/intelligence/signals/service.ts`'s `recordSignal()` is
the single write path for both producers below, upserting on
`[organizationId, sourceType, ruleName, ruleVersion, sourceId]` — a
redelivered event or a re-run scan pass refreshes the existing row instead
of duplicating it.

**Event-driven signals.** Five new `EventMap` events
(`company.created`, `contact.created`, `lead.created`, `lead.stage_changed`,
`task.created`) are published from the existing CRM service functions
(`createCompany`, `createContact`, `createLead`, `changeLeadStage`,
`createTask`), right alongside their existing `publishAuditEvent` call —
same transaction-then-commit ordering already established for billing
webhooks. `billing.subscription_updated` (already published since Sprint 3)
is reused as-is for revenue-relevant signals — no redundant event was
added. `src/server/intelligence/signals/subscriber.ts` bridges these into
`record-company-signal` BullMQ jobs, the exact pattern
`bridgeEventsToJobs` already uses for invitation emails and memory
embeddings — so a transient failure is retried by BullMQ's existing
5-attempt backoff rather than silently dropped the way an unrewrapped
`subscribeEvent` handler's own errors would be.

**Derived signals.** Some patterns can't be detected at mutation time —
`scan-company-signals` (hourly, alongside the existing recurring jobs) pages
through every organization with a cursor (never loading them all into
memory) and evaluates `high_value_stalled_lead` against each org's open
leads. One organization's failure is caught and logged without aborting the
rest of the batch. "Stalled" reuses `analyzeLead()`'s exact staleness
definition; "high value" is relative to each organization's own median
open-lead value (there was no existing absolute threshold to reuse, and a
fixed dollar figure would be meaningless across organizations of very
different sizes) — both fully deterministic, no LLM involved anywhere in
this sprint.

**Scope.** This is foundation only: no Opportunity/Risk/Decision engine, no
autonomy levels above passive observation, no UI. `CompanySignal` is
readable via `listSignals()` but nothing yet renders it.

### Sales Health + Opportunity V1 (Sprint 6)

The first two consumers of the Sprint 5 signal foundation: a deterministic
org-level health score, and the first Opportunity Engine rule. Both are
read-only from the AI's perspective (two new tools, no new mutating tool)
and both are computed, not modeled — no LLM or ML anywhere in this sprint.

**Sales Health scoring.** `computeSalesHealthScore()`
(`src/server/intelligence/health/sales-health.ts`) is a pure function: it
starts at 100 and subtracts a weighted penalty for the share of an
organization's open leads that are high risk (70% weight) or medium risk
(30% weight) — an org with no open leads scores a clean 100 rather than an
undefined value. The risk classification itself isn't reinvented:
`computeSalesHealthEvidence()` runs the same `analyzeLead()`
(`src/server/leads/analysis.ts`) already used by the lead detail page's AI
analysis over every open lead and aggregates the results, so "risky" means
exactly one thing everywhere in the product. `CompanyHealthSnapshot`
(`prisma/schema.prisma`) is an **append-only time series** — unlike
`CompanySignal`'s upsert-based ledger, `recordHealthSnapshot()` always
inserts a new row, so a score-over-time trend stays queryable later.

**Opportunity Engine V1.** `Opportunity` (`prisma/schema.prisma`) is V1's
only rule: "high-value + stalled lead."
`generateOpportunitiesForOrganization()`
(`src/server/intelligence/opportunity/service.ts`) deliberately does **not**
re-derive staleness/value detection — it reads the already-active
`high_value_stalled_lead` `CompanySignal` rows the Sprint 5 scanner
produces and converts each into a scored, explained Opportunity. This keeps
the signal ledger the single source of truth for "is this lead stalled";
recomputing that a second time here would risk the two definitions
drifting apart for no benefit. Upserted on the same
`[organizationId, ruleName, ruleVersion, relatedEntityType,
relatedEntityId]` shape `CompanySignal` uses, via the raw `prisma` client
for the same reason `recordSignal` does (the tenant-scoping extension
doesn't intercept `upsert` — see `src/server/db/tenant.ts`). Critically,
re-detection **never overwrites `status`** once a human has moved an
Opportunity off `new` (`reviewed`/`acted`/`dismissed`) — there's no UI for
that yet this sprint, but the generator already respects it.

**The recurring pass.** `computeCompanyIntelligence()`
(`src/server/intelligence/compute.ts`) is a new hourly job
(`compute-company-intelligence`) that pages through every organization once
— mirroring `scanCompanySignals`'s cursor-paging and per-organization
isolation — recording a health snapshot and refreshing opportunities for
each. It runs independently of `scan-company-signals`; both are idempotent,
so a lead newly flagged by one hourly scan is picked up by the next
Opportunity-generation pass rather than requiring strict ordering between
the two jobs.

**Two new read-only AI tools**, both auto-executable (no approval gate,
same tier as `get_lead`/`search_leads`): `get_company_health` returns the
latest snapshot, computing one on demand (without persisting it) if the
job hasn't run yet for a brand-new organization; `get_opportunities` lists
current opportunities ordered by score, optionally filtered by status.
Both are gated by new `companyHealth:["read"]`/`opportunity:["read"]`
RBAC statements (`src/server/auth/permissions.ts`), granted to every
role including `viewer`, matching the existing read-only pattern for
`company`/`contact`/`lead`/`task`.

**Scope.** Still no Decision Engine, no Risk Engine, no autonomy above
passive read-only tools, no Outcome/Learning loop, no Self-Critique, no
simulation, no ML, no Pulse UI — this sprint only adds the second and
third consumers of the signal foundation Sprint 5 built.

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
- `tests/companies.test.ts`, `tests/contacts.test.ts`, `tests/leads.test.ts`, `tests/tasks.test.ts` — CRM domain CRUD, soft delete, cross-tenant reference validation, audit logging, including reassigning a lead's owner to another member and rejecting one who isn't a member of the organization, and linking a task directly to a contact/company and rejecting ones from a different organization
- `tests/lead-analysis.test.ts` — the deterministic `analyzeLead` risk/next-action rules (pure, no DB)
- `tests/ai-sales-employee.test.ts` — the AI tools via `executeToolCall`, including a real RBAC denial (a viewer genuinely can't `create_task`)
- `tests/e2e-scenario.test.ts` — the full acceptance scenario below, driven end to end
- `tests/planner.test.ts` — `createPlan` against a scripted `AIProvider` test double: valid plans, the direct-answer fallback, every validation-error path (malformed args, unknown tool, over the step cap), and the corrective-retry loop (succeeds after one bad response, still fails after two, sums usage across both attempts)
- `tests/approval-policy.test.ts` — the risk classification table, including the secure-by-default fallback for unrecognized tools
- `tests/agent-executor.test.ts` — the full agent run loop against the real Tool Engine: multi-step completion, halt-on-error (a genuine RBAC denial mid-run), pause/approve/resume, pause/reject/continue, and RBAC preserved on the approval decision itself
- `tests/billing-subscription.test.ts` — default provisioning, checkout/portal session creation against a fake `PaymentProvider`, webhook lifecycle application (`checkout.session.completed`, `customer.subscription.{updated,deleted}`) including idempotency on a redelivered event id, a redelivered already-applied update never writing a second audit entry, and a mid-processing failure rolling back the idempotency insert so a Stripe retry is genuinely reprocessed rather than swallowed as a duplicate
- `tests/billing-usage.test.ts` — the usage ledger, `checkUsageLimit`'s pass/throw boundary, `getUsageSummary`, billing-period rollover (advances free-tier subscriptions, leaves Stripe-managed ones alone), and subscription-status gating: a `past_due` pro subscription throws `SubscriptionInactiveError`, `active`/`trialing` pass, and the free plan is never blocked by status (including when it's `canceled`, the churned-back-down case)
- `tests/billing-limit-enforcement.test.ts` — `runConversationTurn`, `streamConversationTurn`, and `startAgentRun` all refuse to start once a plan's limit is exhausted or its paid subscription is `past_due`, verified without needing a real AI provider key since both checks run before any of them ever resolves a provider
- `tests/billing-seats.test.ts` — `assertSeatAvailable`'s pass/throw boundary (counting pending invitations, not just active members), Enterprise's `seatLimit: null` never blocking, a downgrade leaving existing members in place while blocking new invitations, and `withSeatLimitLock` actually serializing two concurrent invitations racing for the last seat on a real Postgres advisory lock — exactly one succeeds
- `tests/api-keys.test.ts` — key creation (plaintext-once, hash-only persistence), listing, idempotent revocation, `verifyApiKey`'s unknown/revoked/expired rejection and scope filtering, the session-minting mechanism proven to track a key creator's *current* role (an owner's key can `aiConversation:create`, a demoted-to-viewer creator's key can't), and `POST /api/ai/chat`'s bearer-auth path end to end (401 for no/unknown/revoked key, 403 for a key missing the `ai:chat` scope, and a 502 past that point since no AI provider is configured in CI — the same documented boundary the rest of the AI suite hits)
- `tests/audit-log-export.test.ts` — `exportAuditLogsCsv`'s CSV formatting (header row, comma/quote escaping in metadata) and action/targetType/date-range filtering, plus `GET /api/audit-log/export` end to end: 401 unauthenticated, 403 for a viewer (lacks the `export` permission), 200 with the right CSV headers and body for a permitted owner, the export itself landing back in the audit log, and the route's own query-string filters
- `tests/conversation-history.test.ts` — `listConversations`'s title fallback (explicit title vs. a snippet of the first user message) and ordering/archived-exclusion, `getConversationMessages` filtering to user/assistant rows only and rejecting a conversation from another organization, and `archiveConversation` recording the audit entry and rejecting an already-archived or cross-organization conversation
- `tests/organization-lifecycle.test.ts` — `deleteOrganization`'s confirmation-slug gate, skipping Stripe entirely for a free org, aborting (deleting nothing) when Stripe cancellation fails, cancelling a live subscription before deleting a paid org, the durable `organization.deleted` compliance record surviving the org it describes, `assertSafeToDeleteAccount`'s sole-owner block and the co-owner-promotion unblock, `auth.api.deleteUser` end to end (sole owner rejected, normal member and post-transfer owner both succeed), and the `createdBy`/`author`/`user` cascade fix — deleting a user leaves every company/contact/lead/task/note/conversation/agent-run they created intact with that one reference nulled
- `tests/billing-webhook-config.test.ts` — `isWebhookVerificationConfigured()` across all three `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` combinations, and the webhook route's distinct 500 when only the secret key is set
- `tests/company-signals.test.ts` — tenant isolation and cross-tenant rejection on `CompanySignal`, the malformed-payload runtime guard, real event-to-signal propagation for `company.created` and `lead.stage_changed` (published event → real BullMQ job → `recordSignal`, verified against the actual queue, not mocked), duplicate event delivery upserting instead of duplicating, `recordSignal`'s created/updated outcome transition, and that recording a signal never writes an `AuditLog` entry
- `tests/company-signal-scanner.test.ts` — `high_value_stalled_lead` flags a stalled, above-its-org's-median-value lead while correctly skipping a below-median or recently-active one, never flags a won/lost lead, re-running the scan over an already-flagged lead upserts rather than duplicates, and one organization's scan failure (simulated) never stops the rest of the batch from completing
- `tests/billing-subscription.test.ts` (extended) — `billing.subscription_updated` reaches the Intelligence Signal ledger through the same subscriber/queue path as the CRM events above, with `past_due` correctly classified as high severity
- `tests/sales-health.test.ts` — `computeSalesHealthScore`'s pure scoring math (clean 100 with no open leads, high-risk leads penalized more than medium-risk, a mixed portfolio weighted proportionally, always clamped to 0-100), `computeSalesHealthEvidence` correctly aggregating `analyzeLead()`'s per-lead risk classification and excluding won/lost leads and other organizations' leads, and `recordHealthSnapshot`/`getLatestHealthSnapshot` proving snapshots are an append-only time series (two calls create two rows, not an upsert)
- `tests/opportunity-generation.test.ts` — converting an active `high_value_stalled_lead` signal into an Opportunity end to end, no Opportunity created for a lead with no active signal, re-running generation upserts rather than duplicates, a human's triage `status` (e.g. `dismissed`) is never overwritten by re-detection, generation stops once the underlying signal is resolved, tenant isolation on both generation and `listOpportunities`, and `computeCompanyIntelligence` exercising the full recurring pass (health snapshot + opportunities) across organizations
- `tests/company-intelligence-tools.test.ts` — `get_company_health` computing on demand before any snapshot exists vs. returning the latest persisted one, `get_opportunities` listing an organization's opportunities and rejecting an invalid status filter, both tools readable by every role including a read-only viewer, and both AI reads landing in the audit log

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
