import {
  Activity,
  TrendingDown,
  TrendingUp,
  Minus,
  Zap,
  Users,
} from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {} from "@/features/brain/core/types";
import { getInsightCounts } from "@/features/brain/insights/insight.service";
import { getMemoryCount } from "@/features/brain/memory/memory.service";
import { computePulseScore } from "@/features/brain/pulse/pulse-scorer";
import { computePulse } from "@/features/brain/pulse/pulse.service";
import { requireMembership, requireUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Company Health — Atlas" };

export default async function HealthPage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);
  const orgId = membership.organizationId;

  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  const [metrics, memoryCount, insightCounts] = await Promise.all([
    computePulse(orgId, dayStart, now),
    getMemoryCount(orgId),
    getInsightCounts(orgId),
  ]);

  const pulse = computePulseScore(metrics, null);

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

      {/* Pulse Score */}
      <Card className={scoreColor}>
        <CardContent className="flex items-center gap-6 p-6">
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
              Based on today&#39;s activity
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Dimensions */}
      <div className="grid gap-3 sm:grid-cols-3">
        {pulse.dimensions.map(
          (dim: {
            name: string;
            score: number;
            weight: number;
            description: string;
          }) => {
            const DimIcon =
              dim.name === "Engagement"
                ? Activity
                : dim.name === "Velocity"
                  ? Zap
                  : Users;
            return (
              <Card key={dim.name}>
                <CardContent className="p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <DimIcon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{dim.name}</span>
                  </div>
                  {/* Score bar */}
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
                </CardContent>
              </Card>
            );
          }
        )}
      </div>

      {/* Activity Stats */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Today&#39;s Activity</CardTitle>
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

      {/* Insight Summary */}
      {Object.keys(insightCounts).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Insight Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(insightCounts).map(([status, count]) => (
                <Badge key={status} variant="secondary" className="text-xs">
                  {status}: {count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
