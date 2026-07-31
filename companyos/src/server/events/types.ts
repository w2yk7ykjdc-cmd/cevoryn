/**
 * Every domain event the platform emits. Adding a new event means adding a
 * key here with its payload shape — the event bus, outbox, and subscribers
 * are all typed off this map, so a typo or shape mismatch is a compile error
 * rather than a silent no-op at runtime.
 */
export type EventMap = {
  "organization.created": {
    organizationId: string;
    name: string;
    slug: string;
  };
  "organization.invitation.created": {
    invitationId: string;
    organizationId: string;
    organizationName: string;
    inviterEmail: string;
    inviteeEmail: string;
    role: string;
  };
  "organization.member.removed": {
    organizationId: string;
    memberId: string;
    userId: string;
    removedById: string;
  };
  "organization.member.role_changed": {
    organizationId: string;
    memberId: string;
    userId: string;
    previousRole: string;
    newRole: string;
    changedById: string;
  };
  "audit_log.recorded": {
    auditLogId: string;
    organizationId: string;
    action: string;
  };
  "ai.conversation.message_created": {
    conversationId: string;
    messageId: string;
    organizationId: string;
    role: "user" | "assistant" | "system" | "tool";
  };
  "ai.memory.upsert_requested": {
    organizationId: string;
    userId: string | null;
    conversationId: string | null;
    content: string;
    kind: "fact" | "preference" | "summary";
  };
  "ai.tool.invoked": {
    organizationId: string;
    conversationId: string;
    toolName: string;
    status: "success" | "error";
    durationMs: number;
  };
  "task.reminder_due": {
    taskId: string;
    organizationId: string;
    assigneeId: string | null;
    title: string;
  };
};

export type EventName = keyof EventMap;
export type EventPayload<E extends EventName> = EventMap[E];

export type EventHandler<E extends EventName> = (
  payload: EventPayload<E>,
) => void | Promise<void>;
