import type { AIProvider, GenerateRequest, GenerateResult, ProviderId } from "@/server/ai/providers/types";

/**
 * A deterministic `AIProvider` test double for exercising the planner and
 * agent executor without a real model. Testing an external, non-deterministic
 * LLM isn't appropriate in CI — this mirrors how Sprint 1's AI tools are
 * tested directly via `executeToolCall`, except the planner's job (deciding
 * *which* tools to call) is itself model-driven, so it needs a scripted
 * `generate()` response rather than a bypass.
 */
export function createFakeProvider(
  generateImpl: (request: GenerateRequest) => GenerateResult | Promise<GenerateResult>,
): AIProvider {
  return {
    id: "openai" as ProviderId,
    generate: async (request) => generateImpl(request),
    async *stream() {
      throw new Error("stream() is not implemented on this test double");
    },
    async embed() {
      throw new Error("embed() is not implemented on this test double");
    },
  };
}

export type ScriptedStep = { toolName: string; input: Record<string, unknown>; rationale: string };

/** A `propose_plan` tool-call response, as the planner expects from a real model. */
export function planResult(steps: ScriptedStep[]): GenerateResult {
  return {
    content: "",
    toolCalls: [{ id: "fake-plan", name: "propose_plan", arguments: { steps } }],
    finishReason: "tool_calls",
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

/** A plain-text response with no tool call — the planner's "no action needed" fallback path. */
export function directAnswerResult(content: string): GenerateResult {
  return { content, toolCalls: [], finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } };
}

/** A `propose_plan` call whose arguments don't match the schema, to exercise the planner's validation error path. */
export function malformedPlanResult(): GenerateResult {
  return {
    content: "",
    toolCalls: [{ id: "fake-plan-bad", name: "propose_plan", arguments: { steps: "not-an-array" } }],
    finishReason: "tool_calls",
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

/** Returns each result in order on successive `generate()` calls, repeating the last one once exhausted — for testing the planner's corrective-retry loop. */
export function createSequencedProvider(results: GenerateResult[]): AIProvider {
  if (results.length === 0) {
    throw new Error("createSequencedProvider requires at least one result");
  }
  let index = 0;
  return createFakeProvider(() => {
    const result = results[Math.min(index, results.length - 1)]!;
    index += 1;
    return result;
  });
}
