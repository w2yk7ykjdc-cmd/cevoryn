export type PlanStep = {
  toolName: string;
  input: Record<string, unknown>;
  rationale: string;
};

/**
 * The planner's output for one user goal. `steps` is the ordered tool-call
 * sequence to execute; it is empty when the model decided no tool call is
 * needed, in which case `directAnswer` carries the response to show the
 * user without ever reaching the agent executor.
 */
export type Plan = {
  goal: string;
  steps: PlanStep[];
  directAnswer: string | null;
  /** Token cost of the single planning call, for usage metering (src/server/billing/usage). */
  usage: { inputTokens: number; outputTokens: number };
};

/** The planner's own output failed to validate — a malformed plan or a step referencing an unregistered tool. */
export class PlannerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlannerValidationError";
  }
}
