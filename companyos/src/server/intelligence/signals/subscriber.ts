import { subscribeEvent } from "@/server/events/event-bus";
import { enqueue } from "@/server/jobs/queue";

/**
 * Bridges the business domain events Sprint 5 introduces (plus the
 * pre-existing `billing.subscription_updated`) into `record-company-signal`
 * jobs — the exact same event-to-job bridging pattern
 * `bridgeEventsToJobs` (`src/server/jobs/worker.ts`) already uses for
 * `organization.invitation.created`/`ai.memory.upsert_requested`. The
 * handler itself does no DB work; it only enqueues, so a transient failure
 * is retried by BullMQ's existing 5-attempt exponential backoff
 * (`src/server/jobs/queue.ts`) rather than being silently dropped the way a
 * `subscribeEvent` handler's own thrown errors are (see
 * `src/server/events/event-bus.ts`'s per-handler catch/log).
 *
 * Call this once, from the same place `bridgeEventsToJobs` is called
 * (the worker process's startup) — not from request-handling code.
 */
export function registerIntelligenceSubscribers(): void {
  subscribeEvent("company.created", async (payload) => {
    await enqueue("record-company-signal", { eventName: "company.created", payload });
  });
  subscribeEvent("contact.created", async (payload) => {
    await enqueue("record-company-signal", { eventName: "contact.created", payload });
  });
  subscribeEvent("lead.created", async (payload) => {
    await enqueue("record-company-signal", { eventName: "lead.created", payload });
  });
  subscribeEvent("lead.stage_changed", async (payload) => {
    await enqueue("record-company-signal", { eventName: "lead.stage_changed", payload });
  });
  subscribeEvent("task.created", async (payload) => {
    await enqueue("record-company-signal", { eventName: "task.created", payload });
  });
  subscribeEvent("billing.subscription_updated", async (payload) => {
    await enqueue("record-company-signal", { eventName: "billing.subscription_updated", payload });
  });
}
