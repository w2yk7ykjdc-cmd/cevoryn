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
/** Planning is retried once, with the validation error fed back to the model, before giving up. */
const MAX_PLANNING_ATTEMPTS = 2;

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

  let totalUsage = { inputTokens: 0, outputTokens: 0 };
  let lastError: PlannerValidationError | null = null;

  for (let attempt = 1; attempt <= MAX_PLANNING_ATTEMPTS; attempt += 1) {
    const result = await provider.generate({
      model,
      messages,
      tools: [buildProposePlanToolDefinition()],
      maxTokens: 1536,
    });
    totalUsage = {
      inputTokens: totalUsage.inputTokens + result.usage.inputTokens,
      outputTokens: totalUsage.outputTokens + result.usage.outputTokens,
    };

    const proposal = result.toolCalls.find((call) => call.name === PROPOSE_PLAN_TOOL_NAME);
    if (!proposal) {
      return { goal: input.goal, steps: [], directAnswer: result.content || null, usage: totalUsage };
    }

    const parsed = proposePlanSchema.safeParse(proposal.arguments);
    const unknownStep = parsed.success ? parsed.data.steps.find((step) => !getTool(step.toolName)) : undefined;

    if (!parsed.success || unknownStep) {
      const reason = !parsed.success
        ? `Invalid: ${parsed.error.message}.`
        : `Invalid: tool "${unknownStep!.toolName}" does not exist.`;
      lastError = new PlannerValidationError(
        parsed.success
          ? `Planner proposed a call to unknown tool "${unknownStep!.toolName}"`
          : `Planner produced an invalid plan: ${parsed.error.message}`,
      );

      if (attempt < MAX_PLANNING_ATTEMPTS) {
        // Feed the validation error back as the tool's result and let the
        // model correct itself, instead of failing on the first bad response.
        messages.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls });
        messages.push({
          role: "tool",
          toolCallId: proposal.id,
          toolName: proposal.name,
          content: `${reason} Call propose_plan again with corrected arguments that match the schema and use only the tools listed in the system prompt.`,
        });
        continue;
      }
      throw lastError;
    }

    return {
      goal: input.goal,
      steps: parsed.data.steps.map((step) => ({
        toolName: step.toolName,
        input: step.input,
        rationale: step.rationale,
      })),
      directAnswer: null,
      usage: totalUsage,
    };
  }

  // Unreachable — every loop iteration returns or throws — but keeps the
  // function's return type sound without relying on TS narrowing the loop.
  throw lastError ?? new PlannerValidationError("Planner failed to produce a valid plan");
}
