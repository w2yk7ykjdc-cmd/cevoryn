import { z } from "zod";

import { evidenceSchema } from "@/features/brain/trust/json-schemas";
import { captureServerError } from "@/lib/error-reporting";

import type { DecisionCanvas } from "./types";

const decisionOptionSchema = z.object({
  title: z.string(),
  description: z.string(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  risk: z.enum(["low", "medium", "high"]),
  estimatedImpact: z.string(),
});

const scoringDimensionSchema = z.object({
  name: z.string(),
  score: z.number(),
  weight: z.number(),
  reasoning: z.string(),
});

const decisionCanvasSchema = z.object({
  executiveSummary: z.string(),
  problemStatement: z.string(),
  evidence: z.array(evidenceSchema),
  possibleCauses: z.array(z.string()),
  businessImpact: z.string(),
  priorityScore: z.number(),
  scoringBreakdown: z.array(scoringDimensionSchema),
  options: z.array(decisionOptionSchema),
  recommendedDecision: z.string(),
  confidenceScore: z.number(),
  expectedOutcome: z.string(),
  followUpPlan: z.array(z.string()),
});

/**
 * Validates a Decision.canvas Json column against its expected shape.
 * Returns null on a mismatch so a corrupted/stale row is treated as "no
 * canvas available" by the caller instead of throwing or feeding an
 * unvalidated shape into an LLM prompt.
 */
export function parseDecisionCanvas(value: unknown): DecisionCanvas | null {
  const result = decisionCanvasSchema.safeParse(value);
  if (!result.success) {
    captureServerError(
      "brain.json-schemas.decisionCanvas",
      new Error("Decision.canvas failed schema validation"),
      { issues: result.error.issues }
    );
    return null;
  }
  return result.data;
}
