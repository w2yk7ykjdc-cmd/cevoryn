import type { Metadata } from "next";

import { listPreparedActions } from "@/features/brain/actions/action.service";
import { getLatestBrief } from "@/features/brain/brief/brief.service";
import type { BriefSection, PulseMetrics } from "@/features/brain/core/types";
import { listInsights } from "@/features/brain/insights/insight.service";
import { computePulseScore } from "@/features/brain/pulse/pulse-scorer";
import { computePulse } from "@/features/brain/pulse/pulse.service";
import { requireMembership, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { MorningBriefClient } from "./morning-brief-client";

export const metadata: Metadata = { title: "Morning Brief — Atlas" };

const PRIORITY_ORDER: Record<BriefSection["priority"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export default async function BriefPage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);
  const orgId = membership.organizationId;

  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  const [brief, pulseMetrics, previousSnapshot, insights, actions] =
    await Promise.all([
      getLatestBrief(orgId, "DAILY"),
      computePulse(orgId, dayStart, now),
      prisma.pulseSnapshot.findFirst({
        where: { organizationId: orgId, period: "DAILY" },
        orderBy: { createdAt: "desc" },
        select: { metrics: true },
      }),
      listInsights(orgId, { status: "NEW", limit: 3 }),
      listPreparedActions(orgId, "PENDING"),
    ]);

  const previousMetrics = previousSnapshot
    ? (previousSnapshot.metrics as unknown as PulseMetrics)
    : null;
  const pulseScore = computePulseScore(pulseMetrics, previousMetrics);

  const rawSections: BriefSection[] =
    brief && Array.isArray(brief.sections)
      ? (brief.sections as unknown as BriefSection[])
      : [];

  const sections = rawSections
    .filter(
      (section) =>
        section &&
        typeof section.heading === "string" &&
        section.heading.trim().length > 0 &&
        typeof section.content === "string" &&
        section.content.trim().length > 0
    )
    .sort(
      (a, b) =>
        (PRIORITY_ORDER[a.priority] ?? 3) -
        (PRIORITY_ORDER[b.priority] ?? 3)
    )
    .slice(0, 5);

  const briefDate = brief
    ? new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(brief.createdAt)
    : null;

  return (
    <MorningBriefClient
      displayName={membership.displayName}
      briefTitle={brief?.title ?? null}
      briefDate={briefDate}
      sections={sections}
      pulse={{
        score: pulseScore.score,
        trend: pulseScore.trend,
        dimensions: pulseScore.dimensions.map(
          (d: { name: string; score: number; description: string }) => ({
            name: d.name,
            score: d.score,
            description: d.description,
          })
        ),
      }}
      insightCount={insights.length}
      actionCount={actions.length}
      focusItems={insights.slice(0, 3).map((insight) => ({
        id: insight.id,
        title: insight.title,
        summary: insight.summary,
        severity: insight.severity,
        recommendedAction: insight.recommendedAction,
      }))}
      nextActions={actions.slice(0, 3).map((action) => ({
        id: action.id,
        title: action.title,
        description: action.description,
      }))}
      hasBrief={brief !== null}
    />
  );
}
