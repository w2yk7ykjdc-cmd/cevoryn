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
};

export type JobName = keyof JobMap;
export type JobPayload<J extends JobName> = JobMap[J];
