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
  "billing.subscription_updated": {
    organizationId: string;
    subscriptionId: string;
    status: string;
  };
  "billing.usage_limit_exceeded": {
    organizationId: string;
    metric: string;
    limit: number;
    current: number;
  };
  /**
   * Durable, off-tenant compliance record for a permanent organization
   * deletion. Deliberately keyed as `deletedOrganizationId` (not
   * `organizationId`) so `publishEvent`'s auto-scoping never links this
   * `DomainEvent` row to the (now-deleted) organization via its own
   * `organizationId` foreign key — the whole point is that this record
   * outlives the tenant it describes.
   */
  "organization.deleted": {
    deletedOrganizationId: string;
    name: string;
    slug: string;
    deletedByUserId: string;
  };

  // ── Sprint 5: Company Events & Signal Foundation ────────────────────────
  // Raw, synchronous domain events emitted at the moment of mutation. Each
  // carries the mutation's own freshly-created id as a natural, already-
  // unique identifier — the Intelligence Signal Subscriber
  // (src/server/intelligence/signals/subscriber.ts) uses it as the
  // idempotency key when normalizing the event into a `CompanySignal` row,
  // rather than inventing a new event-delivery id.
  "company.created": {
    organizationId: string;
    companyId: string;
    name: string;
    createdById: string;
  };
  "contact.created": {
    organizationId: string;
    contactId: string;
    companyId: string | null;
    createdById: string;
  };
  "lead.created": {
    organizationId: string;
    leadId: string;
    stageId: string;
    value: number;
    createdById: string;
  };
  "lead.stage_changed": {
    organizationId: string;
    leadId: string;
    activityId: string;
    previousStageId: string;
    newStageId: string;
    isWon: boolean;
    isLost: boolean;
  };
  "task.created": {
    organizationId: string;
    taskId: string;
    leadId: string | null;
    assigneeId: string | null;
    dueDate: string | null;
  };
};

export type EventName = keyof EventMap;
export type EventPayload<E extends EventName> = EventMap[E];

export type EventHandler<E extends EventName> = (
  payload: EventPayload<E>,
) => void | Promise<void>;
