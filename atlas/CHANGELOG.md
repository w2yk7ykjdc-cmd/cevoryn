# Changelog

## [1.0.0-rc.1] — Release Candidate 1

### Fixed
- **All `as any` casts eliminated** — 12 unsafe Prisma enum casts replaced with type-safe validators in `enum-validators.ts`
- **Every API handler has try/catch** — 0 uncovered methods remain across all 20 API route files

### Added
- **Team invite UI** — OWNER/ADMIN can invite members via email from `/team` page. Shows pending invites with expiry. RBAC enforced. Member limit checked.
- **Dark mode toggle** — class-based theme switching with localStorage persistence. No external dependencies. Respects system preference on first visit.
- **Enum validators** (`lib/enum-validators.ts`) — centralized type-safe string→enum conversion for all Prisma enums

### Infrastructure
- `POST /api/team/invite` — create invite with email validation, duplicate check, member limit enforcement

## [0.10.0] — Sprint 010: Beta Hardening

### Fixed (Critical)
- **Global error/loading/not-found pages** — users no longer see blank screens on errors, slow loads, or wrong URLs
- **13 API routes hardened** — all handlers wrapped in try/catch with consistent error responses via `api-utils.ts`
- **Password reset flow** — added `/reset-password` page so users can actually set a new password after clicking reset link
- **Env validation at startup** — `instrumentation.ts` checks required env vars on server boot, logs missing ones immediately
- **Login ?next redirect** — middleware's `?next=/brief` parameter is now respected after login instead of always going to `/dashboard`
- **Favicon** — SVG favicon added, no more generic browser icon
- **/chat UX** — no longer creates conversation on every page visit; shows welcome state with explicit "Start a conversation" button

### Fixed (Important)
- **RBAC enforcement** — `hasPermission` checks added to decisions, decision-canvas, memories, outcomes, learning mutation endpoints
- **Rate limiting on Brain APIs** — brief generation, decision pipeline, insight generation now check daily token limits before calling OpenAI
- **Session expiry in chat** — 401 response during streaming now redirects to login instead of showing cryptic error
- **Shared API utilities** — `api-utils.ts` with `unauthorizedResponse()`, `forbiddenResponse()`, `badRequestResponse()`, `notFoundResponse()` for consistent error handling

### Added
- `src/app/error.tsx` — global error boundary with retry button
- `src/app/loading.tsx` — global loading spinner
- `src/app/not-found.tsx` — 404 page with back-to-home link
- `src/app/(dashboard)/loading.tsx` — dashboard loading state
- `src/app/(auth)/reset-password/page.tsx` — password reset form
- `src/app/(chat)/chat/new-chat-redirect.tsx` — explicit new conversation button
- `src/app/icon.svg` — Atlas favicon
- `src/instrumentation.ts` — startup env validation
- `src/lib/api-utils.ts` — shared API error response helpers

## [0.9.0] — Sprint 009: Executive Workspace

### Added

**Morning Brief** (`/brief`)
- Premium full-page brief with Pulse summary, quick stats grid, and AI-generated sections
- Generate Brief button triggers Brain pipeline
- Priority-coded section cards (high/medium/low with icons)
- Empty state with one-click generation CTA

**Company Health** (`/health`)
- Pulse score with color-coded ring (green ≥70, amber ≥40, red <40)
- Three dimension bars: Engagement, Velocity, Coverage with progress visualization
- Today's activity stats: conversations, messages, active users, memories
- Insight status summary badges

**Team** (`/team`)
- Real member list from DB with avatars, role badges, join dates
- Current user indicator ("you")
- Empty team state with invite prompt

**Settings** (`/settings`)
- Organization info: name, slug, creation date
- User account: name, role
- Workspace usage: members, conversations, memories

**Navigation**
- Product-flow sidebar order: Home → Brief → Health → Chat → Team → Settings
- Active state highlights for nested routes

### Changed
- Sidebar: added Health link with Activity icon, reordered navigation
- Dashboard renamed to "Home" in navigation

## [0.8.0] — Sprint 008: CEO Experience / First 60 Seconds

### Added

**Executive Home** (`features/executive/`)
- Server-side data aggregation — single parallel fetch, no waterfalls
- Three states: `active` (priorities exist), `quiet` (nothing urgent), `insufficient_data` (not enough context)
- Mobile-first, max-w-2xl centered layout

**Executive Status** — personalized greeting, date, Pulse score with trend badge, status statement

**Top Priority Card** — dominant priority from Brain's highest-scored insight or decision. Shows category, severity, executive summary, business impact, recommended action with approval button, and full TrustDisclosure

**Attention Queue** — maximum 3 items, server-side priority ranking, compact cards with confidence badges

**Today's Actions** — prepared actions (email/task/calendar/follow-up) with explicit approve/dismiss buttons. No automatic execution. Optimistic UI updates with server sync

**Trust Disclosure** — progressive disclosure component. Collapsed: "Why Atlas thinks this" + confidence badge. Expanded: reasoning, evidence list, missing information. Used throughout the executive experience

**Quiet State** — "Nothing urgent requires your attention today. Focus on growth." Shows resolved issues count and memory count. Calm, valuable

**Insufficient Data State** — honest about what's missing. Lists specific data gaps. Guides user to start a conversation

**Analytics Foundation** (`lib/analytics.ts`)
- Privacy-conscious internal event tracking
- Events: executive_home_viewed, top_priority_opened, evidence_opened, recommended_action_approved/rejected, morning_review_completed
- No sensitive content in payloads — only event names + anonymous IDs
- Server-side recording via POST /api/analytics
- Clean interface ready for DB persistence or external provider swap

### Architecture
- Server Component loads all data → Client Component renders
- No API key exposure, no duplicate calls
- All data org-scoped via requireMembership()
- Reduced motion respected via Tailwind animate utilities

## [0.7.0] — Sprint 007: Outcome Intelligence Engine

### Added

**Outcome Engine** (`features/brain/outcomes/`)
- Full lifecycle: PROPOSED → ACCEPTED/REJECTED/IGNORED → EXECUTED → COMPLETED → SUCCESSFUL/FAILED/UNKNOWN
- Validated state transitions — illegal jumps rejected with error messages
- Every transition timestamped on DecisionTimelineEvent
- `transitionDecision()` with atomic DB transaction

**Outcome Evaluator** (`features/brain/outcomes/outcome-evaluator.ts`)
- AI-powered evaluation: compares expected outcome from canvas with actual user-reported outcome
- Structured result: SUCCESS / FAILURE / PARTIAL_SUCCESS / NO_OUTCOME_YET
- Outcome score (0-1), confidence, explanation, evidence
- Auto-evaluates when decision reaches COMPLETED/SUCCESSFUL/FAILED

**Learning Engine v1** (`features/brain/learning/learning-engine.ts`)
- Pattern extraction from 30-day decision history
- Pattern types: acceptance, success, failure, repeat, timing
- Acceptance rate patterns: overall + high-priority segmentation
- Outcome patterns: success/failure rates stored as learned patterns
- Repeat detection: recurring problem keywords across decisions
- Failed decisions stored as company memory for future context
- Modular, provider-independent architecture

**Confidence Calibrator** (`features/brain/learning/confidence-calibrator.ts`)
- Compares predicted confidence vs actual outcome scores
- Computes adjustment factor: overconfident → reduce, underconfident → slight increase
- Never inflates confidence — increases capped at 5%
- `applyCalibration()` pure function — clamps to [0.05, 0.95]
- Requires minimum 5 data points before calibration activates

**Recommendation Analytics** (`features/brain/learning/analytics.ts`)
- Acceptance rate, success rate, failure rate
- Average time to completion
- Average priority score
- Per-category breakdown
- Full recommendation history with outcome scores

**APIs**
- `GET/POST /api/brain/outcomes` — record outcomes, get lifecycle
- `GET/POST /api/brain/learning` — patterns + calibration, trigger extraction
- `GET /api/brain/recommendation-history` — full decision history
- `GET /api/brain/recommendation-metrics` — performance metrics

### Changed
- DecisionStatus enum expanded: +PROPOSED, +EXECUTED, +SUCCESSFUL, +FAILED, +UNKNOWN
- PENDING renamed to PROPOSED (backwards-compatible default)
- TimelineEventType: +EXECUTION_STARTED, +OUTCOME_EVALUATED, +LEARNING_EXTRACTED

### Database
- Added OutcomeEvaluation model
- Added LearningPattern model
- Added OutcomeResult enum

## [0.6.0] — Sprint 006: Decision Intelligence Engine

### Added

**Decision Engine** (`features/brain/decisions/decision-engine.ts`)
- Full pipeline: Observe → Understand → Detect → Reason → Prioritize → Generate Canvas → Prepare Actions → Learn
- Collects conversation evidence, insight evidence, and company memories
- Generates structured Decision Canvas via AI
- Creates prepared actions from recommendations
- All output wrapped in TrustEnvelope

**Executive Decision Canvas** (`features/brain/decisions/decision-canvas.ts`)
- Structured format: Executive Summary, Problem Statement, Evidence, Possible Causes, Business Impact, Priority Score, Options, Recommended Decision, Confidence Score, Expected Outcome, Follow-up Plan
- Each canvas is explainable — every recommendation includes reasoning
- Fallback canvas when AI generation fails

**Decision Scoring** (`features/brain/decisions/decision-scorer.ts`)
- Five weighted dimensions: Business Impact (30%), Urgency (25%), Confidence (20%), Risk (15%), Company Context (10%)
- Pure functions — fully testable, no side effects
- `computeDecisionScore()` returns score + full breakdown
- Architecture supports future per-organization weight customization

**Decision History** (`features/brain/decisions/decision.service.ts`)
- Tracks: PENDING → ACCEPTED / REJECTED / IGNORED → COMPLETED
- Every status transition recorded on timeline
- Outcome tracking for completed decisions
- Foundation for Learning Engine

**Decision Timeline** (`features/brain/decisions/decision.service.ts`)
- Problem → Canvas Generated → Recommendation Made → User Decision → Outcome
- Full event history per decision
- Stored as DecisionTimelineEvent records

**Executive APIs**
- `POST /api/brain/decisions` — trigger decision pipeline
- `GET /api/brain/decisions` — list decisions by status
- `GET/PATCH /api/brain/decisions/[id]` — get detail, accept/reject/complete
- `POST /api/brain/decision-canvas` — generate canvas without full pipeline
- `GET /api/brain/timeline?decisionId=` — decision lifecycle timeline
- `GET /api/brain/recommendations` — top pending decisions + stats

### Database
- Added `Decision` model with canvas (JSON), priorityScore, status, outcome
- Added `DecisionTimelineEvent` model with type, content, metadata
- Added `DecisionStatus` enum: PENDING, ACCEPTED, REJECTED, IGNORED, COMPLETED
- Added `TimelineEventType` enum

## [0.5.0] — Sprint 005: Executive Intelligence Foundation

### Added

**Trust Engine** (`features/brain/trust/`)
- `TrustEnvelope<T>` — every AI recommendation wrapped with confidence, reasoning, evidence, missing information, and alternative explanations
- Confidence scoring algorithm using weighted evidence with diminishing returns
- Evidence factory functions for conversations, memories, and pulse data
- Atlas NEVER presents uncertain conclusions as facts

**Insight Engine v2** (`features/brain/insights/`)
- Full insight schema: id, title, summary, description, category, severity, impact, confidence, evidence, reasoning, recommendedAction, priority, timestamp
- Every insight is explainable — backed by evidence and reasoning chain
- `getInsightWithTrust()` returns insights wrapped in TrustEnvelope
- Confidence computed from evidence quality and quantity

**Company Pulse v2** (`features/brain/pulse/`)
- Pulse score (0-100) computed from three dimensions: Engagement (40%), Velocity (30%), Coverage (30%)
- Trend detection: improving / stable / declining
- Top contributors identification (positive/negative/neutral factors)
- Scoring algorithm in `pulse-scorer.ts` — pure function, fully testable

**Action Center** (`features/brain/actions/`)
- Prepared actions: EMAIL_DRAFT, TASK, CALENDAR_PROPOSAL, FOLLOW_UP
- NO automatic execution — every action requires explicit user approval
- Actions generated from insights via `action-preparer.ts`
- CRUD API with org-scoped isolation

**Brain Pipeline** (`features/brain/core/pipeline.ts`)
- Full intelligence cycle: Observe → Remember → Understand → Detect → Reason → Prioritize → Recommend → Prepare
- `executePipeline()` orchestrates all brain subsystems
- Output: `IntelligenceReport` wrapped in `TrustEnvelope`

**CEO Brief v1** (`features/brain/brief/`)
- Generated by Atlas Brain pipeline, NOT by directly prompting the LLM
- Sections: Company Pulse, Top 3 Priorities, Executive Insights, Recommended Actions, Confidence Assessment
- Trust metadata included in API response
- Fallback sections when AI generation fails

### Changed
- Insight model: added summary, impact, reasoning, recommendedAction, priority, confidence fields
- Brief service: rebuilt to use brain pipeline instead of direct LLM calls
- Schema: added PreparedAction model with ActionType and ActionStatus enums

### Database Migrations Required
```bash
npx prisma db push  # or npx prisma migrate dev
```

## [0.4.0] — Sprint 004: Atlas Brain Foundation
- Brain module registry and plugin system
- Company Memory with auto-extraction
- Insight Engine v1
- Company Pulse metrics
- CEO Brief foundation

## [0.3.1] — Sprint 003.1: Repository Cleanup
- Removed literal brace-expansion junk directories
- Verified all import chains

## [0.3.0] — Sprint 003: AI Core Engine
- OpenAI streaming via SSE
- Conversation management
- Chat UI (mobile-first)
- Token tracking and rate limiting

## [0.2.0] — Sprint 002: Authentication & Multi-tenancy
- Supabase Auth integration
- Organization + Member + RBAC
- Onboarding flow
- Dashboard shell

## [0.1.0] — Sprint 001: Bootstrap
- Next.js 15 + React 19 project setup
- Tailwind CSS + shadcn/ui
- Prisma + PostgreSQL
- ESLint + Prettier + TypeScript strict
