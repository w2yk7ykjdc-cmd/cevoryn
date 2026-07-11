import "server-only";

import { prisma } from "@/lib/prisma";
import { toInsightCategory, toInsightSeverity, toInsightStatus } from "@/lib/enum-validators";
import { AI_CONFIG } from "@/lib/constants";
import { getAIProvider } from "@/features/ai/providers";
import {
  conversationEvidence,
  createTrustEnvelope,
} from "@/features/brain/trust/trust-engine";
import type { Evidence, TrustEnvelope } from "@/features/brain/trust/types";

/**
 * Insight Engine v2
 *
 * Each Insight contains: id, title, summary, description, category,
 * severity, impact, confidence, evidence, reasoning, recommendedAction,
 * priority, timestamp.
 *
 * Every insight is explainable — backed by evidence and reasoning.
 */

const INSIGHT_V2_PROMPT = `You are analyzing recent conversations from a small team's Management Intelligence Platform.
Identify patterns, recurring themes, risks, opportunities, and actionable insights.

For EACH insight, provide ALL of these fields:
- category: STRATEGIC | OPERATIONAL | TEAM | FINANCIAL | RISK
- severity: INFO | SUGGESTION | WARNING | CRITICAL
- title: concise heading (max 10 words)
- summary: one-sentence overview
- description: detailed explanation (2-3 sentences)
- impact: what happens if this is ignored or acted upon
- reasoning: explain WHY this is an insight and HOW you arrived at this conclusion
- recommendedAction: specific, actionable next step
- priority: 1-10 (10 = most urgent)

Rules:
- Only produce insights backed by conversation evidence.
- Every insight must be explainable. If you cannot explain why, do not include it.
- Never present uncertain conclusions as facts. Use hedging language when confidence is low.

Respond with ONLY a JSON array. No markdown fences, no explanation.
Format: [{"category":"TEAM","severity":"SUGGESTION","title":"...","summary":"...","description":"...","impact":"...","reasoning":"...","recommendedAction":"...","priority":7}]
If no meaningful insights: []`;

interface RawInsight {
  category: string;
  severity: string;
  title: string;
  summary: string;
  description: string;
  impact: string;
  reasoning: string;
  recommendedAction: string;
  priority: number;
}

export async function generateInsights(
  organizationId: string,
  since?: Date
): Promise<number> {
  const lookback = since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const recentMessages = await prisma.message.findMany({
    where: {
      conversation: { organizationId },
      createdAt: { gte: lookback },
      role: { in: ["USER", "ASSISTANT"] },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      role: true,
      content: true,
      conversationId: true,
      createdAt: true,
    },
  });

  if (recentMessages.length < 5) return 0;

  const conversationSummary = recentMessages
    .map(
      (m: { role: string; content: string }) =>
        `[${m.role}] ${m.content.slice(0, 300)}`
    )
    .join("\n");

  try {
    const provider = getAIProvider();
    const { content } = await provider.complete({
      model: AI_CONFIG.defaultModel,
      messages: [
        { role: "system", content: INSIGHT_V2_PROMPT },
        {
          role: "user",
          content: `Analyze these ${recentMessages.length} messages:\n\n${conversationSummary}`,
        },
      ],
      temperature: 0.3,
      maxTokens: 2000,
    });

    const cleaned = content.trim();
    if (!cleaned || cleaned === "[]") return 0;

    let insights: RawInsight[];
    try {
      insights = JSON.parse(cleaned);
    } catch (_parseError) {
      return 0;
    }

    if (!Array.isArray(insights)) return 0;

    const validCategories = new Set(["STRATEGIC", "OPERATIONAL", "TEAM", "FINANCIAL", "RISK"]);
    const validSeverities = new Set(["INFO", "SUGGESTION", "WARNING", "CRITICAL"]);

    let created = 0;
    for (const insight of insights) {
      if (!insight.title || !insight.description) continue;
      if (!validCategories.has(insight.category)) continue;
      if (!validSeverities.has(insight.severity)) continue;

      const existing = await prisma.insight.findFirst({
        where: {
          organizationId,
          title: { equals: insight.title, mode: "insensitive" },
          createdAt: { gte: lookback },
        },
        select: { id: true },
      });
      if (existing) continue;

      const evidence: Evidence[] = recentMessages.slice(0, 3).map(
        (m: { conversationId: string; content: string; createdAt: Date }) =>
          conversationEvidence(
            m.conversationId,
            m.content.slice(0, 200),
            m.createdAt.toISOString()
          )
      );

      const confidence = computeInsightConfidence(insight, evidence.length);

      await prisma.insight.create({
        data: {
          organizationId,
          category: toInsightCategory(insight.category) ?? "OPERATIONAL",
          severity: toInsightSeverity(insight.severity) ?? "INFO",
          title: insight.title,
          summary: insight.summary || "",
          description: insight.description,
          impact: insight.impact || "",
          confidence,
          evidence: JSON.parse(JSON.stringify(evidence)),
          reasoning: insight.reasoning || "",
          recommendedAction: insight.recommendedAction || "",
          priority: Math.max(1, Math.min(10, insight.priority || 5)),
        },
      });

      created++;
    }

    return created;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown";
    console.error(`Insight generation failed: ${msg}`);
    return 0;
  }
}

function computeInsightConfidence(
  insight: RawInsight,
  evidenceCount: number
): number {
  let score = 0.3;
  if (insight.reasoning && insight.reasoning.length > 20) score += 0.2;
  if (insight.impact && insight.impact.length > 10) score += 0.1;
  if (evidenceCount >= 3) score += 0.2;
  else if (evidenceCount >= 1) score += 0.1;
  if (insight.priority >= 8) score += 0.1;
  return Math.min(score, 0.95);
}

export async function listInsights(
  organizationId: string,
  options: { status?: string; limit?: number } = {}
) {
  return prisma.insight.findMany({
    where: {
      organizationId,
      ...(options.status && { status: toInsightStatus(options.status) ?? undefined }),
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    take: options.limit ?? 20,
  });
}

export async function getInsightWithTrust(
  organizationId: string,
  id: string
): Promise<TrustEnvelope<any> | null> {
  const insight = await prisma.insight.findFirst({
    where: { id, organizationId },
  });

  if (!insight) return null;

  return createTrustEnvelope({
    data: insight,
    evidence: (insight.evidence as Evidence[]) || [],
    reasoning: insight.reasoning,
    dataWindowHours: 168,
  });
}

export async function updateInsightStatus(
  organizationId: string,
  id: string,
  status: string
) {
  return prisma.insight.updateMany({
    where: { id, organizationId },
    data: { status: toInsightStatus(status) ?? "NEW" },
  });
}

export async function getInsightCounts(organizationId: string) {
  const results = await prisma.insight.groupBy({
    by: ["status"],
    where: { organizationId },
    _count: { id: true },
  });

  return results.reduce(
    (acc: Record<string, number>, r: { status: string; _count: { id: number } }) => {
      acc[r.status] = r._count.id;
      return acc;
    },
    {} as Record<string, number>
  );
}
