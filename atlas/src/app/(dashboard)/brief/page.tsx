import type { Metadata } from "next";

import { requireMembership, requireUser } from "@/lib/auth";
import { getLatestBrief } from "@/features/brain/brief/brief.service";
import { computePulse } from "@/features/brain/pulse/pulse.service";
import { computePulseScore } from "@/features/brain/pulse/pulse-scorer";
import { listInsights } from "@/features/brain/insights/insight.service";
import { listPreparedActions } from "@/features/brain/actions/action.service";
import type { PulseMetrics, BriefSection } from "@/features/brain/core/types";

import { MorningBriefClient } from "./morning-brief-client";

export const metadata: Metadata = { title: "Morning Brief — Atlas" };

export default async function BriefPage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);
  const orgId = membership.organizationId;

  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  const [brief, pulseMetrics, insights, actions] = await Promise.all([
    getLatestBrief(orgId, "DAILY"),
    computePulse(orgId, dayStart, now),
    listInsights(orgId, { status: "NEW", limit: 3 }),
    listPreparedActions(orgId, "PENDING"),
  ]);

  const pulseScore = computePulseScore(pulseMetrics, null);

  const sections: BriefSection[] = brief
    ? (brief.sections as BriefSection[])
    : [];

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
      hasBrief={brief !== null}
    />
  );
}
