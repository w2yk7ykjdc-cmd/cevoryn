import type { MemoryKind } from "@/server/ai/memory/types";

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
};

export type JobName = keyof JobMap;
export type JobPayload<J extends JobName> = JobMap[J];
