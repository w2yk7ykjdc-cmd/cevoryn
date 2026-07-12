import "server-only";

import { prisma } from "@/lib/prisma";
import { AI_CONFIG } from "@/lib/constants";
import { getAIProvider } from "@/features/ai/providers";
import { conversationEvidence } from "../trust/trust-engine";
import type { Evidence } from "../trust/types";
import { toOutcomeResult } from "@/lib/enum-validators";
import type { DecisionCanvas } from "../decisions/types";

import type { OutcomeEvaluationResult } from "./types";

const EVALUATION_PROMPT = `You are evaluating whether a business recommendation led to a good outcome.

Given:
- The original problem
- The recommended decision
- The expected outcome
- The actual outcome reported by the user

Evaluate the recommendation quality.

Respond with ONLY a JSON object:
{
  "result": "SUCCESS" | "FAILURE" | "PARTIAL_SUCCESS",
  "outcomeScore": 0.0 to 1.0,
  "explanation": "Why this evaluation",
  "lessonsLearned": "What can be learned for future recommendations"
}

Rules:
- Be honest. If the outcome is unclear, score conservatively.
- SUCCESS: recommendation clearly achieved the expected outcome.
- PARTIAL_SUCCESS: some benefit but not fully achieved.
- FAILURE: recommendation did not help or made things worse.
- outcomeScore: 0 = complete failure, 1 = perfect outcome.
- Never inflate scores. Under-promise is better than over-claim.`;

/**
 * Evaluate the outcome of a completed decision.
 * Compares expected outcome (from canvas) with actual outcome (from user).
 */
export async function evaluateOutcome(
  organizationId: string,
  decisionId: string
): Promise<OutcomeEvaluationResult | null> {
  const decision = await prisma.decision.findFirst({
    where: {
      id: decisionId,
      organizationId,
      status: { in: ["COMPLETED", "SUCCESSFUL", "FAILED", "UNKNOWN"] },
    },
  });

  if (!decision || !decision.outcome) return null;

const canvas = decision.canvas as unknown as DecisionCanvas;

  // Build evidence from timeline
  const timelineEvents = await prisma.decisionTimelineEvent.findMany({
    where: { decisionId },
    orderBy: { createdAt: "asc" },
    select: { content: true, createdAt: true },
  });

  const evidence: Evidence[] = timelineEvents.map(
    (e: { content: string; createdAt: Date }) =>
      conversationEvidence(
        decisionId,
        e.content,
        e.createdAt.toISOString(),
        0.6
      )
  );

  try {
    const provider = getAIProvider();
    const { content } = await provider.complete({
      model: AI_CONFIG.defaultModel,
      messages: [
        { role: "system", content: EVALUATION_PROMPT },
        {
          role: "user",
          content: [
            `Problem: ${canvas.problemStatement}`,
            `Recommended: ${canvas.recommendedDecision}`,
            `Expected outcome: ${canvas.expectedOutcome}`,
            `Actual outcome: ${decision.outcome}`,
          ].join("\n"),
        },
      ],
      temperature: 0.2,
      maxTokens: 500,
    });

    const raw = JSON.parse(content.trim());

    const result: OutcomeEvaluationResult = {
      result: validateResult(raw.result),
      outcomeScore: clampScore(raw.outcomeScore),
      confidence: computeEvalConfidence(evidence.length, decision.outcome.length),
      explanation: String(raw.explanation ?? ""),
      evidence,
    };

    // Persist evaluation
    await prisma.outcomeEvaluation.create({
      data: {
        organizationId,
        decisionId,
        result: toOutcomeResult(result.result),
        outcomeScore: result.outcomeScore,
        confidence: result.confidence,
        explanation: result.explanation,
        evidence: JSON.parse(JSON.stringify(result.evidence)),
      },
    });

    // Record on timeline
    await prisma.decisionTimelineEvent.create({
      data: {
        decisionId,
        type: "OUTCOME_EVALUATED",
        content: `Outcome evaluated: ${result.result} (score: ${result.outcomeScore.toFixed(2)})`,
        metadata: {
          result: result.result,
          outcomeScore: result.outcomeScore,
        },
      },
    });

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown";
    console.error(`Outcome evaluation failed: ${msg}`);
    return null;
  }
}

function validateResult(
  value: unknown
): "SUCCESS" | "FAILURE" | "PARTIAL_SUCCESS" | "NO_OUTCOME_YET" {
  const valid = new Set(["SUCCESS", "FAILURE", "PARTIAL_SUCCESS"]);
  if (typeof value === "string" && valid.has(value)) {
    return value as "SUCCESS" | "FAILURE" | "PARTIAL_SUCCESS";
  }
  return "NO_OUTCOME_YET";
}

function clampScore(value: unknown): number {
  if (typeof value !== "number") return 0.5;
  return Math.max(0, Math.min(1, value));
}

function computeEvalConfidence(
  evidenceCount: number,
  outcomeLength: number
): number {
  let c = 0.3;
  if (evidenceCount >= 3) c += 0.2;
  else if (evidenceCount >= 1) c += 0.1;
  if (outcomeLength > 50) c += 0.2;
  else if (outcomeLength > 20) c += 0.1;
  c += 0.1; // AI evaluation adds some confidence
  return Math.min(c, 0.9);
}
