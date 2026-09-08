// Next.js loads .env files itself; this standalone entrypoint (run via
// `tsx`, outside Next) has to load them explicitly, and must do so before
// anything else imports `@/env`.
import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { createBullConnection } from "@/server/redis/client";
import { subscribeEvent, shutdownEventBus } from "@/server/events/event-bus";
import { enqueue, scheduleRecurringJobs, QUEUE_NAME } from "@/server/jobs/queue";
import { logger } from "@/server/logger/logger";
import { env } from "@/env";
import type { JobMap, JobName } from "@/server/jobs/types";
import { sendInvitationEmailProcessor } from "@/server/jobs/processors/send-invitation-email";
import { relayOutboxEventsProcessor } from "@/server/jobs/processors/relay-outbox-events";
import { generateMemoryEmbeddingProcessor } from "@/server/jobs/processors/generate-memory-embedding";
import { sweepTaskRemindersProcessor } from "@/server/jobs/processors/sweep-task-reminders";
import { rollBillingPeriodsProcessor } from "@/server/jobs/processors/roll-billing-periods";
import { recordCompanySignalProcessor } from "@/server/jobs/processors/record-company-signal";
import { scanCompanySignalsProcessor } from "@/server/jobs/processors/scan-company-signals";
import { computeCompanyIntelligenceProcessor } from "@/server/jobs/processors/compute-company-intelligence";
import { evaluatePendingOutcomesProcessor } from "@/server/jobs/processors/evaluate-pending-outcomes";
import { ingestMarketDataProcessor } from "@/server/jobs/processors/ingest-market-data";
import { generateMarketIntelligenceProcessor } from "@/server/jobs/processors/generate-market-intelligence";
import { generateMarketStrategiesProcessor } from "@/server/jobs/processors/generate-market-strategies";
import { registerIntelligenceSubscribers } from "@/server/intelligence/signals/subscriber";

/**
 * Background worker process. Runs as its own container/process (see
 * `Dockerfile`'s `worker` stage and the `worker` service in
 * `docker-compose.yml`), separate from the Next.js web process, so a slow
 * embedding job or email send never blocks a web request.
 *
 * Responsibilities:
 *  1. Consume the BullMQ job queue.
 *  2. Bridge select domain events to jobs (e.g. an invitation-created event
 *     becomes a retryable send-invitation-email job).
 *  3. Keep the outbox-relay job scheduled.
 */
async function processJob(job: Job<JobMap[JobName], void, JobName>): Promise<void> {
  switch (job.name) {
    case "send-invitation-email":
      return sendInvitationEmailProcessor(job.data as JobMap["send-invitation-email"]);
    case "relay-outbox-events":
      return relayOutboxEventsProcessor();
    case "generate-memory-embedding":
      return generateMemoryEmbeddingProcessor(job.data as JobMap["generate-memory-embedding"]);
    case "sweep-task-reminders":
      return sweepTaskRemindersProcessor();
    case "roll-billing-periods":
      return rollBillingPeriodsProcessor();
    case "record-company-signal":
      return recordCompanySignalProcessor(job.data as JobMap["record-company-signal"]);
    case "scan-company-signals":
      return scanCompanySignalsProcessor();
    case "compute-company-intelligence":
      return computeCompanyIntelligenceProcessor();
    case "evaluate-pending-outcomes":
      return evaluatePendingOutcomesProcessor();
    case "ingest-market-data":
      return ingestMarketDataProcessor();
    case "generate-market-intelligence":
      return generateMarketIntelligenceProcessor();
    case "generate-market-strategies":
      return generateMarketStrategiesProcessor();
    default:
      logger.warn({ jobName: job.name }, "no processor registered for job");
  }
}

function bridgeEventsToJobs() {
  subscribeEvent("organization.invitation.created", async (payload) => {
    await enqueue("send-invitation-email", payload);
  });

  subscribeEvent("ai.memory.upsert_requested", async (payload) => {
    await enqueue("generate-memory-embedding", payload);
  });

  registerIntelligenceSubscribers();
}

async function main() {
  const worker = new Worker<JobMap[JobName], void, JobName>(QUEUE_NAME, processJob, {
    connection: createBullConnection(),
    concurrency: 10,
  });

  worker.on("completed", (job) => {
    logger.debug({ jobId: job.id, jobName: job.name }, "job completed");
  });
  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err }, "job failed");
  });

  bridgeEventsToJobs();
  await scheduleRecurringJobs();

  logger.info({ queue: QUEUE_NAME, env: env.NODE_ENV }, "background worker started");

  const shutdown = async () => {
    logger.info("worker shutting down");
    await worker.close();
    await shutdownEventBus();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.error({ err }, "worker failed to start");
  process.exit(1);
});
