import {
  Activity,
  ArrowRight,
  Minus,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PulseMetrics } from "@/features/brain/core/types";
import { getInsightCounts } from "@/features/brain/insights/insight.service";
import { getMemoryCount } from "@/features/brain/memory/memory.service";
import { computePulseScore } from "@/features/brain/pulse/pulse-scorer";
import { computePulse } from "@/features/brain/pulse/pulse.service";
import { requireMembership, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Company Health — Atlas" };

export default async function HealthPage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);
  const orgId = membership.organizationId;

  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  const [metrics, memoryCount, insightCounts, previousSnapshot] =
    await Promise.all([
      computePulse(orgId, dayStart, now),
      getMemoryCount(orgId),
      getInsightCounts(orgId),
      prisma.pulseSnapshot.findFirst({
        where: { organizationId: orgId, period: "DAILY" },
        orderBy: { createdAt: "desc" },
        select: { metrics: true },
      }),
    ]);

  const previousMetrics = previousSnapshot
    ? (previousSnapshot.metrics as unknown as PulseMetrics)
    : null;
  const pulse = computePulseScore(metrics, previousMetrics);
  const weakestDimension = [...pulse.dimensions].sort(
    (a, b) => a.score - b.score
  )[0];
  const openInsights = insightCounts.NEW ?? 0;
  const healthSummary = buildHealthSummary(
    pulse.score,
    pulse.trend,
    weakestDimension?.name,
    openInsights
  );
  const nextMove = buildNextMove(
    weakestDimension?.name,
    weakestDimension?.score ?? 0,
    openInsights
  );

  const TrendIcon =
    pulse.trend === "improving"
      ? TrendingUp
      : pulse.trend === "declining"
        ? TrendingDown
        : Minus;

  const trendColor =
    pulse.trend === "improving"
      ? "text-emerald-600"
      : pulse.trend === "declining"
        ? "text-amber-600"
        : "text-muted-foreground";

  const scoreColor =
    pulse.score >= 70
      ? "border-emerald-300 dark:border-emerald-800"
      : pulse.score >= 40
        ? "border-amber-300 dark:border-amber-800"
        : "border-red-300 dark:border-red-800";

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Company Health</h1>
        <p className="text-sm text-muted-foreground">
          {membership.organizationName}
        </p>
      </div>

      <Card className={scoreColor}>
        <CardContent className="space-y-5 p-6">
          <div className="flex items-center gap-6">
            <div
              className={cn(
                "flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4",
                scoreColor
              )}
            >
              <span className="text-3xl font-bold">{pulse.score}</span>
            </div>
            <div>
              <p className="text-lg font-semibold">Pulse Score</p>
              <div
                className={cn(
                  "flex items-center gap-1.5 text-sm font-medium",
                  trendColor
                )}
              >
                <TrendIcon className="h-4 w-4" />
                {pulse.trend.charAt(0).toUpperCase() + pulse.trend.slice(1)}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Compared with the latest daily snapshot
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              What this means
            </p>
            <p className="mt-1 text-sm leading-relaxed">{healthSummary}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        {pulse.dimensions.map((dim) => {
          const DimIcon =
            dim.name === "Engagement"
              ? Activity
              : dim.name === "Velocity"
                ? Zap
                : Users;
          const isWeakest = weakestDimension?.name === dim.name;

          return (
            <Card key={dim.name} className={isWeakest ? "border-amber-300" : ""}>
              <CardContent className="p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <DimIcon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{dim.name}</span>
                  </div>
                  <span className="text-sm font-semibold">{dim.score}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-2 rounded-full transition-all",
                      dim.score >= 60
                        ? "bg-emerald-500"
                        : dim.score >= 30
                          ? "bg-amber-500"
                          : "bg-red-500"
                    )}
                    style={{ width: `${Math.min(dim.score, 100)}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {dim.description}
                </p>
                {isWeakest && (
                  <Badge variant="secondary" className="mt-2 text-[10px]">
                    Needs attention
                  </Badge>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recommended next move</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-relaxed">{nextMove}</p>
          <Link
            href={`/chat?prompt=${encodeURIComponent(
              `Review our company health. Focus on ${weakestDimension?.name ?? "the weakest area"} and give me the single highest-impact action for today.`
            )}`}
          >
            <Button size="sm">
              Build an action plan
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Today&apos;s Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Conversations" value={metrics.conversationCount} />
            <Stat label="Messages" value={metrics.messageCount} />
            <Stat label="Active Users" value={metrics.activeUserCount} />
            <Stat label="Memories" value={memoryCount} />
          </div>
        </CardContent>
      </Card>

      {Object.keys(insightCounts).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Insight Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(insightCounts).map(([status, count]) => (
                <Badge key={status} variant="secondary" className="text-xs">
                  {formatStatus(status)}: {count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function buildHealthSummary(
  score: number,
  trend: "improving" | "stable" | "declining",
  weakestArea: string | undefined,
  openInsights: number
): string {
  const level =
    score >= 70
      ? "Overall operating health is strong"
      : score >= 40
        ? "Operating health is mixed"
        : "Operating health needs attention";
  const trendText =
    trend === "improving"
      ? "and is improving"
      : trend === "declining"
        ? "and is moving in the wrong direction"
        : "and is broadly stable";
  const focus = weakestArea ? ` The weakest area is ${weakestArea}.` : "";
  const insights =
    openInsights > 0
      ? ` ${openInsights} open insight${openInsights === 1 ? "" : "s"} still need review.`
      : "";

  return `${level} ${trendText}.${focus}${insights}`;
}

function buildNextMove(
  weakestArea: string | undefined,
  weakestScore: number,
  openInsights: number
): string {
  if (openInsights > 0) {
    return `Review the highest-priority open insight first, then choose one action that can improve ${weakestArea ?? "the weakest operating area"} today.`;
  }
  if (weakestScore < 40) {
    return `${weakestArea ?? "The weakest area"} is materially below target. Identify the main blocker, assign one owner, and set a measurable checkpoint for today.`;
  }
  return `Protect the current momentum and choose one focused improvement for ${weakestArea ?? "the lowest-scoring area"} instead of spreading effort across multiple initiatives.`;
}

function formatStatus(status: string): string {
  return status
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
