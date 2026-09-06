/**
 * Generic Worker/Task contract. Research is the only concrete worker today
 * (see research-worker.ts) - this interface exists so a future Sales/
 * Competitive-Intelligence/Finance worker has a shape to implement rather
 * than inventing its own ad hoc lifecycle. Deliberately minimal: no fake
 * multi-worker orchestration is built on top of this yet, per the explicit
 * instruction not to build a simulated autonomous workforce.
 */

export type WorkerType = "RESEARCH";

export interface WorkerTaskInput {
  organizationId: string;
  opportunityId: string;
  requestedByUserId: string;
}

export interface WorkerTaskHandle {
  taskId: string;
}

export interface Worker {
  readonly type: WorkerType;
  /**
   * Fast, synchronous half: claims a WorkerTask row and returns immediately
   * - the actual work happens in execute(), typically scheduled via Next's
   * after() so the caller's HTTP response isn't blocked on an LLM call.
   */
  createTask(input: WorkerTaskInput): Promise<WorkerTaskHandle | null>;
  /** The actual work. Must be safe to schedule post-response (no return value depended on by the caller). */
  execute(taskId: string): Promise<void>;
}
