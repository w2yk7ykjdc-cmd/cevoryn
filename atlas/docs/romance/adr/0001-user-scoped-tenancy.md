# ADR-0001: Romance Engine is scoped by `userId`, not by Cevoryn's `Organization`

**Status:** Accepted
**Date:** 2026-10-06

## Context

Cevoryn's entire existing tenancy model is Organization-centric:

- `Member` (B2B team member) belongs to exactly one `Organization` via a
  unique `(userId, organizationId)` pair.
- Onboarding (`src/features/onboarding/actions/onboarding.ts`) forces every
  new Supabase user through a "name your organization" form before they can
  reach `/dashboard` at all (`DashboardLayout` redirects to `/onboarding` if
  `getMembership(user.id)` returns null).
- `maxOrganizations: 1` on every plan (`billing/config/plans.ts`) means the
  product already assumes one real person ↔ one Organization — the
  "Organization" is really just "this user's account," wearing B2B language.
- Every piece of shared infrastructure (`AuditLog`, `Subscription`,
  billing `BILLING_FEATURES`, RBAC roles OWNER/ADMIN/MEMBER, Team invites)
  is keyed by `organizationId` and carries B2B semantics (roles, invites,
  seats) that have no meaning for a single-player interactive-fiction
  product.

Romance ("The Court of Thorns") is a consumer, single-player product: one
person creates one character and plays through one evolving story. There is
no team, no invite, no seat, no "OWNER vs MEMBER" distinction to make.

## Decision

Romance Engine tables are rooted in a new `RomancePlayer` model keyed
directly by the Supabase `userId` (`@unique`), **not** by
`Organization`/`Member`. Romance routes and actions call `requireUser()`
directly and never call `getMembership()` or touch `Organization` at all.

Romance gets its own, independent pieces where the B2B ones don't fit
semantically, reusing the same *mechanism* but not the same *table*:

| Concern | Cevoryn B2B mechanism | Romance mechanism |
|---|---|---|
| Identity | Supabase Auth (`getUser()`) | **Same** — reused as-is |
| Tenancy root | `Organization` (B2B) | `RomancePlayer` (keyed by `userId`) |
| Entitlement | `Subscription` (org-scoped, STARTER/PROFESSIONAL/BUSINESS) | `RomanceSubscription` (player-scoped, FREE/PREMIUM) — independent table, independent product (`POLAR_PRODUCT_ROMANCE_PREMIUM`) and checkout/portal routes, but reuses the same Polar account/access-token/webhook-secret and the same shared webhook endpoint (routed by metadata key, not product id) — see Product Bible's "Live payment integration" section |
| Audit | `AuditLog` (org-scoped, non-nullable `organizationId`) | `RomanceAuditLog` (player-scoped) — a new table rather than loosening `AuditLog`'s FK, so no existing B2B audit query or constraint is touched |
| AI provider | `AIProvider` interface (`src/features/ai/providers`) | **Same interface, reused directly** — it is already provider-agnostic and has no Organization coupling |
| Rate limiting | `auth-rate-limit.service.ts` (Postgres advisory-lock pattern) | **Same pattern reused** for Romance action-level abuse limits (new rows, same proven technique) |
| Route group | `(dashboard)` — requires `getMembership` | New `(romance)` route group — requires only `requireUser()` |

## Consequences

- **No change to any existing Cevoryn table, route, or middleware rule.**
  Romance is purely additive: new Prisma models, a new route group, new
  feature folder (`src/features/romance/**`). The existing Radar/Brain/
  Enterprise/Billing surfaces are untouched.
- A Romance player never sees "organization," "team," "invite," or
  "member role" anywhere in the product.
- Multi-tenant isolation for Romance is `WHERE playerId = ?` (backed by the
  authenticated `userId`) everywhere, exactly mirroring the discipline
  already proven for `organizationId` scoping elsewhere in this codebase
  (verified in this session's own prior audit: zero bare `id`-only lookups
  found in any service file).
- If Romance later needs a "share this story with a friend" or co-op
  feature, that is new, explicit product scope — it does not retroactively
  need Organization/Member; it would be a new, explicit sharing primitive.
- A user can have both a Cevoryn B2B Organization (as OWNER) *and* a
  Romance player profile; the two are linked only by sharing the same
  Supabase `userId`, never by a foreign key between `Organization` and
  `RomancePlayer`.

## Rejected alternative

**Reuse `Organization` as the Romance tenancy root** (auto-create a hidden
personal Organization per Romance signup). Rejected because:
- It would force every Romance player through organization-shaped
  onboarding UI or require a parallel, silent organization-creation path
  that duplicates `createOrganization()`'s invariants for no product
  reason.
- It would couple Romance's entitlement model to the B2B `BillingPlan` enum
  (`STARTER`/`PROFESSIONAL`/`BUSINESS`), which has no FREE/PREMIUM
  consumer meaning and is already used for a materially different pricing
  surface.
- It would put romance audit events in the same `AuditLog` table an
  org ADMIN can view at `/settings/audit-log` — a real privacy leak of a
  deeply personal product surface into a B2B admin screen.
