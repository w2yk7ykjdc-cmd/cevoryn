/**
 * Dedicated Workers / enterprise worker policy foundation (Phase 2, section
 * 16), building on the Worker/WorkerTask abstraction introduced in
 * src/features/radar/workers/types.ts.
 *
 * Status: types only. Every organization's WorkerTask rows share the same
 * table and the same execution path (processResearchTask running inline,
 * scheduled via Next's after()) - there is no per-plan concurrency limit,
 * priority queue, or dedicated compute today, and building one without a
 * real queueing backend would be simulating infrastructure that doesn't
 * exist. This exists so that when CEVORYN does need to give e.g. Business
 * plan organizations higher worker concurrency or a dedicated execution
 * lane, the policy has a shape to be read from, and research-worker.ts's
 * Worker-interface implementations don't need to change to respect it.
 */

import type { WorkerType } from "@/features/radar/workers/types";

export interface WorkerPolicy {
  organizationId: string;
  workerType: WorkerType;
  /** Max concurrently RUNNING WorkerTask rows for this org+workerType. Unenforced today - every task runs inline as soon as created. */
  maxConcurrentTasks: number;
  /** Whether this org's tasks may run on a dedicated (non-shared) execution lane. Always false until dedicated compute exists. */
  dedicatedLane: boolean;
}

export const DEFAULT_WORKER_POLICY: Omit<WorkerPolicy, "organizationId"> = {
  workerType: "RESEARCH",
  maxConcurrentTasks: 1,
  dedicatedLane: false,
};
