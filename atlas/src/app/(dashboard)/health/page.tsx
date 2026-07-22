import {
  Activity,
  ArrowRight,
  Minus,
  ShieldAlert,
  Target,
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

  const [metrics, memoryCount, insightCounts, previousSnapshot] = await Promise.all([
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
  const rankedDimensions = [...pulse.dimensions].sort((a, b) => a.score - b.score);
  const weakestDimension = rankedDimensions[0];
  const strongestDimension = rankedDimensions.at(-1);
  const openInsights = insightCounts.NEW ?? 0;
  const diagnoses = rankedDimensions.map((dimension) => ({
    ...dimension,
    status: dimension.score >= 70 ? "healthy" : dimension.score >= 40 ? "watch" : "critical",
    action: buildDimensionAction(dimension.name, dimension.score),
  }));

  const TrendIcon =
    pulse.trend === "improving"
      ? TrendingUp
      : pulse.trend === "declining"
        ? TrendingDown
        : Minus;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Operating diagnosis</p>
          <h1 className="text-2xl font-bold tracking-tight">Company Health</h1>
          <p className="text-sm text-muted-foreground">{membership.organizationName}</p>
        </div>
        <Link href="/brief">
          <Button variant="outline" size="sm">Open Morning Brief</Button>
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardContent className="space-y-5 p-6">
            <div className="flex items-center gap-5">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 border-primary/25 bg-primary/5">
                <span className="text-3xl font-bold">{pulse.score}</span>
              </div>
              <div>
                <p className="text-lg font-semibold">Company pulse</p>
                <div className={cn("flex items-center gap-1.5 text-sm font-medium", pulse.trend === "improving" ? "text-emerald-600" : pulse.trend === "declining" ? "text-amber-600" : "text-muted-foreground")}>
                  <TrendIcon className="h-4 w-4" />
                  {formatStatus(pulse.trend)}
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {buildHealthSummary(pulse.score, pulse.trend, weakestDimension?.name, openInsights)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4" /> Today&apos;s management focus
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm leading-relaxed">
              {buildNextMove(weakestDimension?.name, weakestDimension?.score ?? 0, openInsights)}
            </p>
            <Link href={`/chat?prompt=${encodeURIComponent(`Act as my chief of staff. Diagnose why ${weakestDimension?.name ?? "our weakest operating area"} is underperforming and produce one owner, one measurable outcome, and a 24-hour action plan.`)}`}>
              <Button size="sm">Create recovery plan <ArrowRight className="h-4 w-4" /></Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Strongest area" value={strongestDimension?.name ?? "—"} detail={strongestDimension ? `${strongestDimension.score}/100` : "No data"} />
        <SummaryCard label="Weakest area" value={weakestDimension?.name ?? "—"} detail={weakestDimension ? `${weakestDimension.score}/100` : "No data"} />
        <SummaryCard label="Open signals" value={String(openInsights)} detail="Insights awaiting review" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operating diagnosis</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-3">
          {diagnoses.map((dimension) => {
            const Icon = dimension.name === "Engagement" ? Activity : dimension.name === "Velocity" ? Zap : Users;
            return (
              <div key={dimension.name} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <p className="font-medium">{dimension.name}</p>
                  </div>
                  <Badge variant={dimension.status === "critical" ? "destructive" : "secondary"}>{dimension.score}</Badge>
                </div>
                <div className="mt-3 h-2 rounded-full bg-muted">
                  <div className={cn("h-2 rounded-full", dimension.status === "healthy" ? "bg-emerald-500" : dimension.status === "watch" ? "bg-amber-500" : "bg-red-500")} style={{ width: `${Math.min(dimension.score, 100)}%` }} />
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{dimension.description}</p>
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-muted/50 p-3">
                  {dimension.status === "critical" ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <Target className="mt-0.5 h-4 w-4 shrink-0" />}
                  <p className="text-xs leading-relaxed">{dimension.action}</p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Today&apos;s evidence</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Conversations" value={metrics.conversationCount} />
            <Stat label="Messages" value={metrics.messageCount} />
            <Stat label="Active users" value={metrics.activeUserCount} />
            <Stat label="Memories" value={memoryCount} />
            <Stat label="Open insights" value={openInsights} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function buildDimensionAction(name: string, score: number): string {
  if (name === "Engagement") return score < 40 ? "Run one focused team check-in and capture blockers before noon." : "Protect communication cadence and close unanswered threads.";
  if (name === "Velocity") return score < 40 ? "Select one blocked outcome, assign a single owner, and define a same-day checkpoint." : "Reduce work in progress and finish the highest-value open action.";
  return score < 40 ? "Clarify ownership for the most important decision and record the missing context in Atlas." : "Keep company context current so decisions remain grounded.";
}

function buildHealthSummary(score: number, trend: "improving" | "stable" | "declining", weakestArea: string | undefined, openInsights: number): string {
  const level = score >= 70 ? "Operating health is strong" : score >= 40 ? "Operating health is mixed" : "Operating health needs intervention";
  const direction = trend === "improving" ? "and improving" : trend === "declining" ? "and moving in the wrong direction" : "and broadly stable";
  return `${level} ${direction}. ${weakestArea ? `${weakestArea} is the main constraint.` : ""} ${openInsights > 0 ? `${openInsights} open insight${openInsights === 1 ? "" : "s"} need review.` : "No open insight is waiting."}`;
}

function buildNextMove(weakestArea: string | undefined, weakestScore: number, openInsights: number): string {
  if (openInsights > 0) return `Review the highest-priority signal, then commit to one action that improves ${weakestArea ?? "the weakest area"} today.`;
  if (weakestScore < 40) return `${weakestArea ?? "The weakest area"} is below target. Name the blocker, assign one owner, and set a measurable checkpoint within 24 hours.`;
  return `Protect momentum and make one focused improvement in ${weakestArea ?? "the lowest-scoring area"}.`;
}

function formatStatus(status: string): string {
  return status.toLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p><p className="text-xs text-muted-foreground">{detail}</p></CardContent></Card>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="text-center"><p className="text-2xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>;
}
