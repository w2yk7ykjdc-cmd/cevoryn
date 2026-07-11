import "server-only";

import { prisma } from "@/lib/prisma";
import { conversationEvidence, createTrustEnvelope } from "../trust/trust-engine";
import type { Evidence, TrustEnvelope } from "../trust/types";
import { getMemoriesForContext } from "../memory/memory.service";
import { listInsights } from "../insights/insight.service";
import { prepareActionsFromInsight } from "../actions/action-preparer";

import type { DecisionCanvas } from "./types";
import { generateDecisionCanvas } from "./decision-canvas";
import { createDecision } from "./decision.service";

/**
 * Decision Engine — the complete decision intelligence pipeline.
 *
 * Pipeline stages:
 * 1. OBSERVE — collect signals (insights, conversations, memories)
 * 2. UNDERSTAND — build context from company knowledge
 * 3. DETECT — identify the decision-worthy problem
 * 4. REASON — analyze causes and options
 * 5. PRIORITIZE — score the decision
 * 6. GENERATE CANVAS — produce structured decision support
 * 7. PREPARE ACTIONS — create actionable next steps
 * 8. LEARN — store for future reference (timeline + memory)
 */
export async function executeDecisionPipeline(params: {
  organizationId: string;
  problemDescription: string;
  sourceInsightId?: string;
}): Promise<
  TrustEnvelope<{
    decisionId: string;
    canvas: DecisionCanvas;
    actionsGenerated: number;
  }>
> {
  const { organizationId, problemDescription } = params;

  // ── OBSERVE: collect evidence ──
  const evidence: Evidence[] = [];

  const recentMessages = await prisma.message.findMany({
    where: {
      conversation: { organizationId },
      role: "USER",
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      content: { contains: problemDescription.split(" ").slice(0, 3).join(" "), mode: "insensitive" },
    },
    take: 5,
    select: { conversationId: true, content: true, createdAt: true },
  });

  for (const msg of recentMessages) {
    evidence.push(
      conversationEvidence(
        msg.conversationId,
        msg.content,
        msg.createdAt.toISOString(),
        0.6
      )
    );
  }

  // Add insight as evidence if provided
  if (params.sourceInsightId) {
    const insight = await prisma.insight.findFirst({
      where: { id: params.sourceInsightId, organizationId },
      select: { title: true, description: true, createdAt: true },
    });
    if (insight) {
      evidence.push({
        source: "insight",
        sourceId: params.sourceInsightId,
        excerpt: `${insight.title}: ${insight.description.slice(0, 200)}`,
        timestamp: insight.createdAt.toISOString(),
        weight: 0.8,
      });
    }
  }

  // ── UNDERSTAND + DETECT + REASON + PRIORITIZE + GENERATE CANVAS ──
  const canvasEnvelope = await generateDecisionCanvas({
    organizationId,
    problemDescription,
    evidence,
  });

  const canvas = canvasEnvelope.data;

  // ── LEARN: store the decision ──
  const decision = await createDecision({
    organizationId,
    canvas,
    priorityScore: canvas.priorityScore,
  });

  // ── PREPARE ACTIONS: generate from the recommendation ──
  let actionsGenerated = 0;
  if (canvas.recommendedDecision) {
    actionsGenerated = await prepareActionsFromInsight({
      organizationId,
      insightId: decision.id,
      insightTitle: canvas.problemStatement,
      insightDescription: canvas.recommendedDecision,
      insightRecommendedAction: canvas.followUpPlan.join(". "),
      confidence: canvas.confidenceScore,
    });
  }

  return createTrustEnvelope({
    data: {
      decisionId: decision.id,
      canvas,
      actionsGenerated,
    },
    evidence,
    reasoning: `Decision pipeline executed with ${evidence.length} evidence items. Canvas scored ${canvas.priorityScore}/10 priority. ${actionsGenerated} action(s) prepared.`,
    missingInformation: canvasEnvelope.missingInformation,
    alternativeExplanations: canvasEnvelope.alternativeExplanations,
    dataWindowHours: 168,
  });
}
