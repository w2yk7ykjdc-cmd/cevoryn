import { Queue, type JobsOptions } from "bullmq";
import { createBullConnection } from "@/server/redis/client";
import { env } from "@/env";
import type { JobMap, JobName, JobPayload } from "@/server/jobs/types";

// BullMQ queue names cannot contain ":" (it uses that as the Redis key
// delimiter internally), so the prefix is joined with "-" instead.
const QUEUE_NAME = `${env.JOB_QUEUE_PREFIX}-jobs`;

let queue: Queue<JobMap[JobName]> | undefined;

function getQueue(): Queue<JobMap[JobName]> {
  queue ??= new Queue(QUEUE_NAME, {
    connection: createBullConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { count: 1000, age: 24 * 60 * 60 },
      removeOnFail: { count: 5000 },
    },
  });
  return queue;
}

export async function enqueue<J extends JobName>(
  name: J,
  payload: JobPayload<J>,
  options?: JobsOptions,
): Promise<string> {
  const job = await getQueue().add(name, payload, options);
  return job.id ?? "";
}

/** Schedules (or re-schedules idempotently) the recurring outbox relay job. */
export async function scheduleRecurringJobs(): Promise<void> {
  await getQueue().upsertJobScheduler(
    "relay-outbox-events-scheduler",
    { every: 30_000 },
    { name: "relay-outbox-events", data: {} },
  );
}

export { QUEUE_NAME };
