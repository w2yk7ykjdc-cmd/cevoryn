import "server-only";

import { getAIProvider } from "@/features/ai/providers";
import { AI_CONFIG } from "@/lib/constants";

import { listInsights } from "../insights/insight.service";
import { getMemoriesForContext } from "../memory/memory.service";
import { createTrustEnvelope } from "../trust/trust-engine";
import type { Evidence, TrustEnvelope } from "../trust/types";

import { computeDecisionScore, parseScoringResponse } from "./decision-scorer";
import type { DecisionCanvas, DecisionOption } from "./types";

const CANVAS_GENERATION_PROMPT = `You are Atlas, a Management Intelligence Platform.
Transform the given business problem into a structured Decision Canvas.

You MUST return a JSON object with exactly these fields:
{
  "executiveSummary": "2-3 sentence overview",
  "problemStatement": "Clear, specific problem definition",
  "possibleCauses": ["cause 1", "cause 2", "cause 3"],
  "businessImpact": "What happens if this is not addressed",
  "options": [
    {
      "title": "Option name",
      "description": "What this option entails",
      "pros": ["advantage 1", "advantage 2"],
      "cons": ["disadvantage 1"],
      "risk": "low|medium|high",
      "estimatedImpact": "Expected result"
    }
  ],
  "recommendedDecision": "The recommended course of action with reasoning",
  "expectedOutcome": "What should happen if the recommendation is followed",
  "followUpPlan": ["step 1", "step 2", "step 3"],
  "scoring": {
    "businessImpact": {"score": 1-10, "reasoning": "why"},
    "urgency": {"score": 1-10, "reasoning": "why"},
    "confidence": {"score": 1-10, "reasoning": "why"},
    "risk": {"score": 1-10, "reasoning": "why"},
    "companyContext": {"score": 1-10, "reasoning": "why"}
  }
}

Rules:
- Provide at least 2 options, maximum 4.
- Be specific and actionable. No vague advice.
- Scoring must include reasoning for every dimension.
- recommendedDecision must reference one of the options.
- Never present uncertain conclusions as facts.

Respond with ONLY the JSON object. No markdown fences.`;

/**
 * Generate a Decision Canvas from a problem description.
 * Uses company memory and active insights for context.
 */
export async function generateDecisionCanvas(params: {
  organizationId: string;
  problemDescription: string;
  evidence: Evidence[];
}): Promise<TrustEnvelope<DecisionCanvas>> {
  const { organizationId, problemDescription } = params;

  // Gather company context
  const [memories, insights] = await Promise.all([
    getMemoriesForContext(organizationId, 15),
    listInsights(organizationId, { status: "NEW", limit: 5 }),
  ]);

  const contextLines: string[] = [];
  if (memories.length > 0) {
    contextLines.push(
      "Company knowledge: " +
        memories.map((m: { content: string }) => m.content).join("; ")
    );
  }
  if (insights.length > 0) {
    contextLines.push(
      "Active insights: " +
        insights.map((i: { title: string }) => i.title).join("; ")
    );
  }

  const userMessage = [`Problem: ${problemDescription}`, ...contextLines].join(
    "\n\n"
  );

  try {
    const provider = getAIProvider();
    const { content } = await provider.complete({
      model: AI_CONFIG.defaultModel,
      messages: [
        { role: "system", content: CANVAS_GENERATION_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      maxTokens: 2500,
    });

    const raw = JSON.parse(content.trim());

    // Score the decision
    const scoringInput = parseScoringResponse(raw.scoring ?? {});
    const { score, dimensions } = computeDecisionScore(scoringInput);

    // Validate options
    const options: DecisionOption[] = Array.isArray(raw.options)
      ? raw.options.map((o: Record<string, unknown>) => ({
          title: String(o.title ?? ""),
          description: String(o.description ?? ""),
          pros: Array.isArray(o.pros) ? o.pros.map(String) : [],
          cons: Array.isArray(o.cons) ? o.cons.map(String) : [],
          risk: validateRisk(o.risk),
          estimatedImpact: String(o.estimatedImpact ?? ""),
        }))
      : [];

    const canvas: DecisionCanvas = {
      executiveSummary: String(raw.executiveSummary ?? ""),
      problemStatement: String(raw.problemStatement ?? problemDescription),
      evidence: params.evidence,
      possibleCauses: Array.isArray(raw.possibleCauses)
        ? raw.possibleCauses.map(String)
        : [],
      businessImpact: String(raw.businessImpact ?? ""),
      priorityScore: score,
      scoringBreakdown: dimensions,
      options,
      recommendedDecision: String(raw.recommendedDecision ?? ""),
      confidenceScore: Math.min(
        (scoringInput.confidence.score / 10) * 0.95,
        0.95
      ),
      expectedOutcome: String(raw.expectedOutcome ?? ""),
      followUpPlan: Array.isArray(raw.followUpPlan)
        ? raw.followUpPlan.map(String)
        : [],
    };

    return createTrustEnvelope({
      data: canvas,
      evidence: params.evidence,
      reasoning: `Decision canvas generated from problem analysis with ${memories.length} company memories and ${insights.length} active insights as context.`,
      dataWindowHours: 168,
    });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Canvas generation failed";
    console.error(`Decision canvas error: ${msg}`);

    // Return minimal canvas rather than failing
    const fallbackCanvas: DecisionCanvas = {
      executiveSummary: "Unable to generate full analysis.",
      problemStatement: problemDescription,
      evidence: params.evidence,
      possibleCauses: [],
      businessImpact: "Analysis required.",
      priorityScore: 5,
      scoringBreakdown: [],
      options: [],
      recommendedDecision: "Gather more information before deciding.",
      confidenceScore: 0.1,
      expectedOutcome: "",
      followUpPlan: ["Collect additional data", "Revisit this decision"],
    };

    return createTrustEnvelope({
      data: fallbackCanvas,
      evidence: params.evidence,
      reasoning:
        "Canvas generation encountered an error. Fallback analysis provided.",
      missingInformation: ["Full AI analysis unavailable"],
      dataWindowHours: 0,
    });
  }
}

function validateRisk(value: unknown): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value;
  return "medium";
}
