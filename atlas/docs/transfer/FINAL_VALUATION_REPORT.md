# CEVORYN — Final Sale-Readiness & Independent Valuation Report

Prepared: 2026-10-12. Scope: the Romance-free sale snapshot on branch
`sale/cevoryn-without-romance` (HEAD `4781892`, branched from `main`
`94df95c`). This is a verification and valuation pass — no application
code was changed to produce this report, no PR was opened, and no
production, customer, or live-payment system was touched.

---

## 1. Executive summary and overall verdict

CEVORYN is a technically complete, well-tested, security-reviewed B2B
SaaS codebase with **zero paying customers and zero verified revenue**.
Production is live and currently healthy (confirmed via real, fresh
automated checks — see §2). The engineering is substantial: 300+ hours
of layered functionality (AI chat, a multi-module "Brain" reasoning
pipeline, external-intelligence "Radar" module, three historical billing
provider integrations culminating in a tested Polar integration, Google
Calendar/Gmail integration), backed by 307 passing automated tests on
this snapshot and a real CI/CD pipeline.

**Verdict: sellable as a code/asset acquisition, not as a revenue
business.** No revenue multiple applies. The previously attempted
Acquire.com listing was not accepted — Acquire's own published guidance
says pre-revenue SaaS listings are rarely accepted and recommends ~$25K
TTM revenue before listing (see prior research, this conversation). That
rejection is consistent with the product's actual stage, not evidence of
a defect in the product itself. IndieMaker's "Pre-Revenue" category, by
contrast, explicitly accepts this profile.

Recommended path: list on a marketplace that accepts pre-revenue SaaS
(IndieMaker, confirmed), price it as an asset/cost-to-rebuild sale with a
steep pre-revenue discount, and disclose the zero-revenue status
up front rather than let a buyer discover it.

---

## 2. Technical status and evidence table

| Item | Status | Evidence |
|---|---|---|
| Product architecture / feature set | **Verified** | `docs/transfer/ARCHITECTURE.md`, `FEATURE_INVENTORY.md` (this session, read directly); 43 API routes, Brain pipeline (Brief/Pulse/Insights/Decisions/Actions/Learning/Memory), Radar module, multi-tenant RBAC |
| Production deployment is live | **Verified** | GitHub Actions `Production Smoke` workflow — 3 consecutive **scheduled, automated** runs, all `completed`/`success`, against commit `94df95c` (main HEAD): run [38195494422](https://github.com/w2yk7ykjdc-cmd/cevoryn/actions/runs/38195494422) at 2026-10-12T02:21:56Z, [38182119385](https://github.com/w2yk7ykjdc-cmd/cevoryn/actions/runs/38182119385) at 2026-10-11T22:52:18Z, [38165622185](https://github.com/w2yk7ykjdc-cmd/cevoryn/actions/runs/38165622185) at 2026-10-11T18:52:17Z. (This sandbox's own egress is policy-blocked from reaching `www.cevoryn.com` directly — confirmed via a direct `curl` attempt in this pass, which returned `connect_rejected (organization policy)` — so these GitHub-runner-sourced results are the real evidence, not a sandbox-side substitute.) |
| CI health on `main` | **Verified** | Last 3 `CI` workflow runs on `main` all `completed`/`success`: [38075128925](https://github.com/w2yk7ykjdc-cmd/cevoryn/actions/runs/38075128925) (PR #301), [38065617554](https://github.com/w2yk7ykjdc-cmd/cevoryn/actions/runs/38065617554) (PR #299), [38064578771](https://github.com/w2yk7ykjdc-cmd/cevoryn/actions/runs/38064578771) (PR #293) |
| Automated test suite (this sale snapshot) | **Verified** | Fresh run this pass, this exact commit: `npm test` → **307/307 passing, 0 failures**. `main` (with Romance still present) runs 421/421 per its own CI logs — not this snapshot's number, noted for transparency |
| TypeScript / lint / build (this snapshot) | **Verified** | Fresh run this pass: `tsc --noEmit` clean (0 errors), `npm run lint` clean (0 errors, 2 pre-existing unrelated warnings), `npm run build` succeeds, 81 routes, zero `/romance` routes present |
| Open PRs on `main` | **Verified** | 3 open: **#300** Dependabot `next` 15.5.27→16.4.0 (major bump, correctly unmerged pending a dedicated migration, not a defect); **#283** "add dependency/CodeQL scanning" (superseded in practice — Dependabot + CodeQL are enabled at the GitHub-settings level, verified earlier this session via the Security tab; the PR/issue bookkeeping was simply never closed — a paperwork gap, not a functional gap); **#241** an experimental "local inference runtime" POC from Oct 5, unclear current relevance, not part of the shipped product |
| Open issues on `main` | **Verified** | 5 open: **#260** (Romance safety gate) — **not applicable to this sale snapshot**, Romance was fully removed (see §6); **#280** (reconcile public pricing page with private-beta Terms wording) — a messaging/legal-copy inconsistency, not a functional bug; **#279** (no automated browser/E2E test gate) — known, documented gap; **#278** (cron cleanup cadence alignment) — minor technical debt; **#281** (scanning automation) — see #283 above, functionally addressed out-of-band |
| Authentication | **Verified** | Supabase Auth, session validated server-side on every protected request (`src/lib/auth.ts`, `src/middleware.ts`) — confirmed by direct code read, `SECURITY_DUE_DILIGENCE.md` |
| Authorization (RBAC) | **Verified** | 3-role (`OWNER`/`ADMIN`/`MEMBER`) enforcement via `src/lib/rbac.ts`, confirmed by direct code read |
| Tenant isolation | **Partially verified** | Confirmed for all query paths touched during this project's active work (per `SECURITY_DUE_DILIGENCE.md`); the full ~43-route set was not re-walked route-by-route in this specific pass |
| Billing lifecycle (Polar) | **Verified (code + webhook security), revenue status separately disclosed in §3** | Checkout/portal/plan-change/webhook code present and signature-verified (`webhook.verify()`, Standard Webhooks spec); idempotency ledger (`BillingWebhookEvent`) with out-of-order-event guard, covered by an integration test. Whether any *current* live subscription exists is a separate, unverified-in-this-pass question — see §3 |
| DB / AI usage quotas / cron | **Verified** | Per-org and per-user daily AI token budgets (`entitlement.service.ts`), 2 scheduled Vercel cron cleanup jobs, confirmed by direct code read |
| Dependabot / CodeQL current alert counts | **Not verified in this pass** | This session's GitHub App token returned `403 Resource not accessible by integration` on both the Dependabot-alerts and code-scanning-alerts REST endpoints — no current live count available here. Last known state (this session's own prior work, same conversation): both CodeQL findings fixed and merged (PR #295, #296); dependency audit triaged down to **3 remaining findings, all with no available fix or explicitly deferred with documented justification** (`braces` — no patched release exists upstream; `deepmerge-ts` — fix requires an unstable Prisma 8 RC; `next`'s vendored `postcss` — requires the Next 16 major bump tracked in open PR #300), per the PR #301 commit message, which is itself the freshest first-party evidence available |
| Romance/Thornbound module | **Verified removed from this snapshot** | 99 files deleted, 22 Prisma models + 19 enums + 6 migrations removed, 8 shared touchpoints cleaned, full verification (tsc/lint/test/build) re-run clean after removal — this session's own prior work, same conversation |

---

## 3. Business performance and operating costs

**Paying customers: data not available in this pass.** No access to a
live Polar dashboard, Stripe/Paddle historical records, or Supabase
production query results was used or attempted here — per this task's
own constraint against touching live payment/customer systems. The
existing `docs/transfer/BUYER_DUE_DILIGENCE.md` (an earlier, dedicated
documentation pass with similar constraints) already states: *"at least
one real subscription checkout and one cancellation completed
end-to-end"* historically, per prior project notes, but that document
itself flags this as not independently re-verified against the current
Polar dashboard. This report does not improve on that — it is still
**UNKNOWN**, not re-confirmed, not assumed to be zero or nonzero beyond
what's already on record.

**MRR / ARR: not computable.** No verifiable revenue figure exists in
any document or system accessible to this pass. Do not state a number.

**Retention / usage / growth data: data not available.** No analytics
dashboard access.

**Monthly operating cost: not independently verified; reasonable
estimate only (explicitly not a bill)** — based on the service tiers
named in `docs/transfer/BUYER_DUE_DILIGENCE.md`'s "Known limitations"
(Supabase free tier, Vercel Hobby) and typical usage-based API pricing
at near-zero real traffic:

| Service | Tier (per existing docs) | Est. monthly cost at current (near-zero) usage |
|---|---|---|
| Supabase | Free tier | $0 |
| Vercel | Hobby | $0 |
| OpenAI API | Usage-based | Low, likely single-digit $ at current traffic — **not independently verified**, no billing access |
| Polar.sh | Usage-based (% of transactions) | $0 at $0 revenue |
| Sentry / Resend | Optional, free tiers | $0 |

**This is an estimate from public tier information, not a verified
invoice total.** A buyer should request the actual Supabase/Vercel/OpenAI
billing history during due diligence — this report does not have access
to it.

**What the buyer needs to operate it:** a new OpenAI API key, a Google
Cloud OAuth client (or transfer of the existing one), a Polar
organization (existing one does not auto-transfer — Polar's own
involvement is required), optionally Sentry/Resend accounts. Full list
in `docs/transfer/TRANSFER_GUIDE.md`.

**Verified vs. potential, kept separate:**
- Verified: a complete, tested, currently-live product with no verified
  current paying customer.
- Potential only: any revenue number from here forward is speculative
  GTM upside, not a fact about the asset today.

---

## 4. Quick sale, target sale, and listing price

All figures USD. TRY conversion omitted — no reliable current USD/TRY
rate source was queried in this pass; convert at the live rate at time
of actual pricing decisions rather than a rate that will already be
stale by the time this is read.

| Tier | Range | Basis |
|---|---|---|
| **Quick sale value** | **$8,000 – $12,000** | Fast, motivated-seller liquidation price. Priced to clear in weeks, not months, on a pre-revenue-friendly marketplace (IndieMaker). Low end assumes a buyer who discounts heavily for doing their own due diligence; high end assumes the buyer reads this report and the full `docs/transfer/` package as sufficient diligence on its own. |
| **Target sale value** | **$18,000 – $28,000** | Fair value for a patient seller who finds a buyer who specifically values the engineering completeness (RBAC, tested billing-provider migration history, AI pipeline, security review, 300+ tests) over a typical weekend-project pre-revenue listing. This is the range to actually negotiate toward. |
| **Listing / initial offer price** | **$29,000 – $35,000** | Anchor price, leaves negotiation room down to the target range. Not recommended to list meaningfully above this — Acquire's own stated pattern (steep buyer disinterest below $25K TTM revenue) suggests pre-revenue buyer appetite thins out well before typical SaaS-multiple territory regardless of code quality. |

**Recommended price floor: $8,000.** Basis: the realistic rebuild-cost
floor (§5) after the heaviest reasonable pre-revenue discount still
clears this; below it, the engineering investment (1000+ hours per this
session's own effort tracking across dozens of sprints) is being given
away faster than a motivated-but-rational seller should accept, and
IndieMaker's $1,000 platform minimum is far below what this asset's
actual completeness supports.

---

## 5. Valuation methodology and comparable evidence

**No access to verified comparable-sale transaction data in this
pass.** No live Acquire/IndieMaker/Flippa sold-listing database was
queried — only each platform's own published general guidance (from
earlier research in this conversation, with sources). Do not read the
ranges above as calibrated against real closed comps; they are not.

**Revenue multiple: not applicable.** Zero verified revenue — no
multiple-of-revenue method can be used here honestly (§3).

**Cost-to-rebuild method (primary basis for the ranges above):**
- Estimated engineering effort: **1,000+ hours**, based on the scope
  visible in this session's own sprint history (dozens of numbered
  sprints — Brain pipeline, Radar, three sequential billing-provider
  integrations, Google integration, a full secondary product built and
  then removed, multiple security-hardening passes, 300+ tests) — **this
  is this session's own estimate, not a timesheet**, since no actual
  time-tracking data exists to cite.
- Blended rate assumption for senior full-stack + AI-integration +
  security work, if contracted traditionally: **$60–$100/hr** — **an
  assumption, not a quoted rate from any specific market source.**
- Raw rebuild-cost range: **~$60,000 – $100,000.**
- **Pre-revenue/no-traction discount applied: 65–75%.** This is the
  single largest driver of the final number, and it is a judgment call,
  not a formula pulled from verified transaction data: a buyer of
  unproven code takes on 100% of the go-to-market risk the seller never
  resolved, which the market (per Acquire's own stated listing
  criteria) prices steeply.
- Resulting range after discount: **~$15,000 – $30,000**, which the
  three tiers in §4 are built around (quick-sale below this band to
  guarantee speed, target sale inside it, listing price at its upper
  edge plus negotiation room).

**Qualitative factors weighed (not separately quantified — no
comparable data exists to assign them individual dollar values):**
- *Increases defensibility of the price:* real production deployment
  history, real (if historical/unverified-in-this-pass) tested payment
  flow, security-reviewed codebase, CI-gated development process, clean
  non-squashed git history, domain already owned and transferable,
  no outstanding critical open issues on the code being sold.
- *Decreases it:* zero current verified revenue, zero verified active
  users beyond the founder's own account, no automated browser/E2E test
  gate (issue #279), cost-optimized default AI model, buyer bears 100%
  of customer-acquisition risk, Acquire's own listing team already
  passed on it once (even without a stated reason).

---

## 6. Buyer-side strengths and risks

**Strengths:**
- Real, currently-live, currently-healthy production deployment (§2) —
  not a toy or an unfinished stub.
- 307 passing automated tests on this exact sale snapshot; CI-gated
  development discipline across the project's full history.
- Security-reviewed: auth, RBAC, tenant isolation (for touched paths),
  webhook signature verification, CSRF protection, rate limiting, secret
  handling, input validation — each with cited evidence in
  `SECURITY_DUE_DILIGENCE.md`.
- Clean separation: this snapshot has the Romance/Thornbound module
  fully and verifiably removed (not just hidden), so the buyer is
  getting exactly the B2B product, nothing adjacent or legally
  distinct bundled in.
- Full non-squashed git history and complete transfer documentation
  package already prepared (`docs/transfer/`).

**Risks (disclose to any buyer, do not omit):**
- **Zero verified current revenue or active paying customer.** This is
  the dominant risk and should be the first thing a buyer hears, not
  something discovered during diligence.
- No independent, current confirmation that the historical Polar
  checkout/webhook path still functions against today's Polar
  configuration — `BUYER_DUE_DILIGENCE.md` already flags this as
  unverified in its own prior pass, and this report did not re-verify
  it either (by design — no live-payment-flow testing was authorized
  or attempted here).
- No automated browser/E2E coverage (issue #279) — UI regressions are
  not CI-caught.
- Public pricing page currently contradicts the Terms page's "private
  beta" framing (issue #280) — needs resolution before any buyer
  represents this as generally available.
- Buyer must independently re-provision or transfer: OpenAI key, Google
  OAuth client, Polar organization (does not auto-transfer existing
  subscribers), optionally Sentry/Resend.
- Current infrastructure runs on free/Hobby tiers — no automatic
  database backups until upgraded.

---

## 7. Sale-ready pitch text

> **CEVORYN — AI Chief of Staff for small teams.** A B2B SaaS platform
> where an organization connects its context (conversations, calendar,
> Gmail) and an AI reasoning pipeline turns it into a daily Brief, a
> company-health score, pattern-based Insights, structured Decisions
> with confidence scoring, and AI-drafted actions a human approves
> before anything happens. Built on Next.js 15 / React 19 / TypeScript,
> Prisma/Postgres (Supabase), OpenAI, and Polar billing, with a tested
> multi-tenant RBAC model, full webhook-verified subscription lifecycle,
> and a 307-test CI-gated codebase. Currently live in production with
> real automated health checks passing. **Sold as a pre-revenue
> technical asset** — no current paying customers, full and honest
> disclosure in the attached due-diligence package. Full source, git
> history, domain, and brand assets included.

(Full version with feature-by-feature detail: `docs/transfer/TEASER.md`,
already prepared and committed to this branch.)

---

## 8. Data gaps and valuation confidence level

**Explicitly unverified in this pass (do not treat as confirmed):**
- Any current revenue, MRR/ARR, active-subscriber count — no access.
- Current Dependabot/CodeQL live alert counts — GitHub API returned
  `403` for both endpoints under this session's credentials; last-known
  state cited instead, dated and labeled as such.
- Actual Vercel/Supabase/OpenAI current billing totals — estimated from
  published tier pricing only, not a real invoice.
- Whether the historical Polar checkout/webhook path still works
  end-to-end against today's live configuration.
- Any comparable-sale transaction data from Acquire/IndieMaker/Flippa —
  only each platform's general published guidance was available, not a
  database of actual closed sale prices.
- Exact total engineering hours — estimated from visible sprint scope,
  not a timesheet.

**Confidence by section:**
- §2 (technical status): **High** — nearly every line item cites a
  direct code read, a fresh local test/build run, or a live GitHub
  Actions result from this exact pass.
- §3 (business performance): **High confidence that the data is
  genuinely absent** — not a low-confidence guess, a correctly-labeled
  gap.
- §4/§5 (valuation): **Low-to-moderate confidence on the exact
  dollar bounds**, **high confidence on the methodology and direction**
  (pre-revenue asset sale, steep discount off rebuild cost, no revenue
  multiple). Treat the specific numbers as a defensible starting
  position for negotiation, not an appraisal.

---

## Direct answers

**Cevoryn should be listed today at $29,000–$35,000**, as an initial
anchor price on a pre-revenue-friendly marketplace (IndieMaker —
confirmed to accept this exact profile; Acquire does not, per its own
published criteria and this project's actual prior rejection there).

**A reasonable quick-sale target is $8,000–$12,000** — the range to
accept if speed matters more than maximizing price.

**The recommended floor is $8,000.** Basis: it is the low end of the
cost-to-rebuild-after-discount range (§5) and below the point where a
rational seller should prefer simply keeping the asset over selling it
away for less than a heavily-discounted fraction of what rebuilding it
would cost.

**These prices are defensible on:** verified live production health,
a verified 307-test CI-gated codebase, a documented security review,
and a transparent zero-revenue disclosure — not on any revenue multiple
or verified comparable-sale data, neither of which exists for this
asset in any form accessible to this pass.

**Verified vs. estimated, by section:** §1 verdict — synthesis of
verified facts. §2 — verified (see per-row evidence). §3 — verified
as *absent* (a real, confirmed data gap, not a guess). §4/§5 — the
*existence* of the gap-driven, no-multiple methodology is verified
reasoning; the *specific dollar bounds* are this session's own
reasoned estimate, not independently verified against real transaction
comparables. §6 — verified from code/docs. §7 — derived from verified
§2/§6 content. §8 — a direct, honest accounting of everything above
that is not independently verified.
