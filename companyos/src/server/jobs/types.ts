import type { MemoryKind } from "@/server/ai/memory/types";
import type { EventMap } from "@/server/events/types";

/**
 * The domain events the Intelligence Signal Subscriber
 * (`src/server/intelligence/signals/subscriber.ts`) bridges into
 * `record-company-signal` jobs — every business event Sprint 5 introduces,
 * plus the pre-existing `billing.subscription_updated` (reused as-is, see
 * that module's doc comment).
 */
type IntelligenceEventName =
  | "company.created"
  | "contact.created"
  | "lead.created"
  | "lead.stage_changed"
  | "task.created"
  | "billing.subscription_updated";

/**
 * Every background job the platform runs. Like `EventMap`, this is the
 * single source of truth for job payload shapes — `enqueue` and the
 * worker's dispatch switch are both typed off it.
 */
export type JobMap = {
  "relay-outbox-events": Record<string, never>;
  "send-invitation-email": {
    invitationId: string;
    organizationId: string;
    organizationName: string;
    inviterEmail: string;
    inviteeEmail: string;
    role: string;
  };
  "generate-memory-embedding": {
    organizationId: string;
    userId: string | null;
    conversationId: string | null;
    content: string;
    kind: MemoryKind;
  };
  "sweep-task-reminders": Record<string, never>;
  "roll-billing-periods": Record<string, never>;
  "record-company-signal": {
    [K in IntelligenceEventName]: { eventName: K; payload: EventMap[K] };
  }[IntelligenceEventName];
  "scan-company-signals": Record<string, never>;
  "compute-company-intelligence": Record<string, never>;
  "evaluate-pending-outcomes": Record<string, never>;
  "ingest-market-data": Record<string, never>;
  "generate-market-intelligence": Record<string, never>;
  "generate-market-strategies": Record<string, never>;
  "evaluate-paper-trading": Record<string, never>;
  /**
   * Sprint 25: the CONTROLLED AUTONOMOUS EXECUTION pass -- for every
   * organization that has BOTH `LIVE_EXECUTION_ENABLED=true` (deployment-
   * wide, operator-only) AND its own `OrganizationExecutionAutonomyPolicy`
   * explicitly enabled, generates this pass's market decisions and submits
   * every valid, capital-allocation-approved one via the existing,
   * unchanged `submitDecision` pipeline. A no-op, zero-database-iteration
   * skip when `LIVE_EXECUTION_ENABLED` is `false` (the default).
   */
  "run-autonomous-execution": Record<string, never>;
  /**
   * Sprint 26: adaptive-learning pass -- strategy degradation detection,
   * quarantine, retirement, and TRIAL-to-ACTIVE graduation, computed purely
   * from Sprint 18's own `getStrategyEvaluations`.
   */
  "evaluate-strategy-health": Record<string, never>;
  /**
   * Sprint 21: executes ONE already-created, `PENDING` `BacktestRun` row --
   * loads its `config`, fetches the real historical candle data, runs
   * Sprint 20's own unchanged `runBacktest`, and persists the result. Not a
   * recurring job (no `scheduleRecurringJobs` entry) -- enqueued on-demand
   * exactly once per run, by `backtest/run-service.ts#createBacktestRun`.
   * The payload is just the row's id, not its full config, so a retried
   * job attempt always re-reads the current row rather than replaying a
   * possibly-stale in-memory payload.
   */
  "run-backtest": { backtestRunId: string; organizationId: string };
};

export type JobName = keyof JobMap;
export type JobPayload<J extends JobName> = JobMap[J];
