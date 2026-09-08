import { recordSignal } from "@/server/intelligence/signals/service";
import { logger } from "@/server/logger/logger";
import type { JobMap } from "@/server/jobs/types";

const UNHEALTHY_SUBSCRIPTION_STATUSES = new Set(["past_due", "canceled", "incomplete"]);

/**
 * Normalizes one bridged domain event into a `CompanySignal` row.
 *
 * These are "passthrough" signals — a direct, certain fact about a mutation
 * that already happened (as opposed to the scanner's "detected" signals,
 * which infer a pattern from data and carry a data-quality-driven
 * confidence) — so `confidence` is uniformly `100` here. `ruleVersion` is
 * `"v1"` for every mapping below; if a mapping's logic changes later, bump
 * it so historical signals aren't silently reinterpreted.
 *
 * Note on `billing.subscription_updated`: every update for the same
 * subscription upserts the *same* signal row (keyed by `subscriptionId`),
 * refreshing its severity as status changes. This sprint does not implement
 * auto-resolution (flipping `status` back to "resolved" once a subscription
 * recovers) — that's a reconciliation concern for the future Risk Engine,
 * deliberately out of scope for this foundation.
 */
/**
 * A stale job body from before an `EventMap` shape change, or corrupted
 * Redis data, could in principle reach this processor with a missing
 * required field despite the compile-time `JobMap` contract — this guard
 * makes that fail loudly (and retry via BullMQ's existing backoff) rather
 * than writing a half-populated, misleading `CompanySignal` row.
 */
function assertValidPayload(eventName: string, payload: unknown): asserts payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object" || typeof (payload as { organizationId?: unknown }).organizationId !== "string") {
    throw new Error(`record-company-signal: malformed payload for event "${eventName}" — missing organizationId`);
  }
}

export async function recordCompanySignalProcessor(data: JobMap["record-company-signal"]): Promise<void> {
  const { eventName, payload } = data;
  assertValidPayload(eventName, payload);
  const ruleVersion = "v1";

  const result = await (async () => {
    switch (eventName) {
      case "company.created":
        return recordSignal({
          organizationId: payload.organizationId,
          type: eventName,
          sourceType: "domain_event",
          sourceId: payload.companyId,
          severity: "low",
          confidence: 100,
          ruleName: eventName,
          ruleVersion,
          relatedEntityType: "Company",
          relatedEntityId: payload.companyId,
          payload,
        });
      case "contact.created":
        return recordSignal({
          organizationId: payload.organizationId,
          type: eventName,
          sourceType: "domain_event",
          sourceId: payload.contactId,
          severity: "low",
          confidence: 100,
          ruleName: eventName,
          ruleVersion,
          relatedEntityType: "Contact",
          relatedEntityId: payload.contactId,
          payload,
        });
      case "lead.created":
        return recordSignal({
          organizationId: payload.organizationId,
          type: eventName,
          sourceType: "domain_event",
          sourceId: payload.leadId,
          severity: "low",
          confidence: 100,
          ruleName: eventName,
          ruleVersion,
          relatedEntityType: "Lead",
          relatedEntityId: payload.leadId,
          payload,
        });
      case "lead.stage_changed":
        return recordSignal({
          organizationId: payload.organizationId,
          type: eventName,
          sourceType: "domain_event",
          sourceId: payload.activityId,
          severity: payload.isLost ? "medium" : "low",
          confidence: 100,
          ruleName: eventName,
          ruleVersion,
          relatedEntityType: "Lead",
          relatedEntityId: payload.leadId,
          payload,
        });
      case "task.created":
        return recordSignal({
          organizationId: payload.organizationId,
          type: eventName,
          sourceType: "domain_event",
          sourceId: payload.taskId,
          severity: "low",
          confidence: 100,
          ruleName: eventName,
          ruleVersion,
          relatedEntityType: "Task",
          relatedEntityId: payload.taskId,
          payload,
        });
      case "billing.subscription_updated":
        return recordSignal({
          organizationId: payload.organizationId,
          type: eventName,
          sourceType: "domain_event",
          sourceId: payload.subscriptionId,
          severity: UNHEALTHY_SUBSCRIPTION_STATUSES.has(payload.status) ? "high" : "low",
          confidence: 100,
          ruleName: eventName,
          ruleVersion,
          relatedEntityType: "Subscription",
          relatedEntityId: payload.subscriptionId,
          payload,
        });
    }
  })();

  logger.info(
    { eventName, organizationId: payload.organizationId, outcome: result.outcome, signalId: result.signal.id },
    "company signal recorded",
  );
}
