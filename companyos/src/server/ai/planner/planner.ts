import "@/server/ai/tools/builtin"; // registers built-in tools as a side effect
import type { AIProvider, ChatMessage, ProviderId } from "@/server/ai/providers/types";
import { getProvider, resolveDefaultTarget, resolveProviderForModel } from "@/server/ai/providers/registry";
import { getTool, listToolDefinitions } from "@/server/ai/tools/registry";
import {
  buildProposePlanToolDefinition,
  proposePlanSchema,
  PROPOSE_PLAN_TOOL_NAME,
} from "@/server/ai/planner/schema";
import { PlannerValidationError, type Plan } from "@/server/ai/planner/types";

const PLANNER_SYSTEM_PROMPT =
  "You are the planning phase of the CompanyOS AI Sales Employee. You do not take any action " +
  "yourself — you only decide what should happen. Read the user's goal and the conversation so " +
  "far, then call propose_plan exactly once with the ordered list of tool calls required to " +
  "accomplish it. Each step's toolName must be exactly one of the tool names listed below, and " +
  "its input must be a JSON object matching that tool's parameters. Keep the plan as short as " +
  "possible — do not add steps that do not directly serve the goal, and do not repeat a read-only " +
  "tool you already have enough information from. If the goal is a question you can answer from " +
  "the conversation alone, or does not require any tool, call propose_plan with an empty steps " +
  "array.";

export type CreatePlanInput = {
  goal: string;
  /** Prior conversation turns to give the planner context, oldest first. */
  history?: ChatMessage[];
  /** Inject a test double instead of resolving a real provider from the registry. */
  provider?: AIProvider;
  providerId?: ProviderId;
  model?: string;
};

/**
 * Analyzes a user's goal and produces an ordered tool-call plan via the
 * model's function-calling support, using a synthetic `propose_plan` tool
 * that is never added to the real Tool Engine registry. The plan itself
 * takes no action — `src/server/ai/agent` executes it step by step through
 * the existing RBAC-checked Tool Engine.
 */
export async function createPlan(input: CreatePlanInput): Promise<Plan> {
  const target = resolveDefaultTarget();
  const model = input.model ?? target.model;
  const provider = input.provider ?? getProvider(input.providerId ?? resolveProviderForModel(model));

  const catalog = listToolDefinitions();
  const catalogText =
    catalog.length > 0
      ? catalog
          .map((tool) => `- ${tool.name}: ${tool.description}\n  parameters: ${JSON.stringify(tool.parameters)}`)
          .join("\n")
      : "(no tools are currently registered)";

  const messages: ChatMessage[] = [
    { role: "system", content: `${PLANNER_SYSTEM_PROMPT}\n\nAvailable tools:\n${catalogText}` },
    ...(input.history ?? []),
    { role: "user", content: input.goal },
  ];

  const result = await provider.generate({
    model,
    messages,
    tools: [buildProposePlanToolDefinition()],
    maxTokens: 1536,
  });

  const proposal = result.toolCalls.find((call) => call.name === PROPOSE_PLAN_TOOL_NAME);

  if (!proposal) {
    return { goal: input.goal, steps: [], directAnswer: result.content || null, usage: result.usage };
  }

  const parsed = proposePlanSchema.safeParse(proposal.arguments);
  if (!parsed.success) {
    throw new PlannerValidationError(`Planner produced an invalid plan: ${parsed.error.message}`);
  }

  for (const step of parsed.data.steps) {
    if (!getTool(step.toolName)) {
      throw new PlannerValidationError(`Planner proposed a call to unknown tool "${step.toolName}"`);
    }
  }

  return {
    goal: input.goal,
    steps: parsed.data.steps.map((step) => ({
      toolName: step.toolName,
      input: step.input,
      rationale: step.rationale,
    })),
    directAnswer: null,
    usage: result.usage,
  };
}
