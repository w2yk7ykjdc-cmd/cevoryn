import { z } from "zod";
import type { ToolDefinition } from "@/server/ai/providers/types";

/** Hard cap on how many steps a single plan may contain — keeps a run bounded and reviewable. */
export const MAX_PLAN_STEPS = 8;

export const PROPOSE_PLAN_TOOL_NAME = "propose_plan";

export const planStepSchema = z.object({
  toolName: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
  rationale: z.string().min(1).max(500).describe("One sentence: why this step is needed."),
});

export const proposePlanSchema = z.object({
  steps: z.array(planStepSchema).max(MAX_PLAN_STEPS),
});

/**
 * A synthetic tool definition, never registered in the real Tool Engine
 * registry, passed only to the planning-phase `provider.generate()` call so
 * the model returns a structured plan via each provider's existing
 * function-calling support instead of free-form text.
 */
export function buildProposePlanToolDefinition(): ToolDefinition {
  return {
    name: PROPOSE_PLAN_TOOL_NAME,
    description:
      "Propose the ordered sequence of tool calls needed to accomplish the user's goal. Call this " +
      "exactly once, after deciding the full plan. If the goal can be answered directly without " +
      "taking any action, call it with an empty steps array.",
    parameters: z.toJSONSchema(proposePlanSchema, { target: "draft-7" }) as Record<string, unknown>,
  };
}
