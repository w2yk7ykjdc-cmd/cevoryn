import { ArrowRight, BrainCircuit, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMembership, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { ActionQueue } from "./action-queue";
import { DecisionQueue } from "./decision-queue";

export const metadata: Metadata = { title: "Intelligence — Atlas" };
export const dynamic = "force-dynamic";

export default async function IntelligencePage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);
  const organizationId = membership.organizationId;

  const [insights, decisions, actions, decisionHistory, actionHistory] =
    await Promise.all([
      prisma.insight.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          title: true,
          summary: true,
          description: true,
          recommendedAction: true,
          category: true,
          severity: true,
          status: true,
          priority: true,
          confidence: true,
        },
      }),
      prisma.decision.findMany({
        where: {
          organizationId,
          status: { in: ["PROPOSED", "ACCEPTED", "EXECUTED"] },
        },
        orderBy: [{ priorityScore: "desc" }, { createdAt: "desc" }],
        take: 20,
        select: {
          id: true,
          status: true,
          priorityScore: true,
          canvas: true,
        },
      }),
      prisma.preparedAction.findMany({
        where: { organizationId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          title: true,
          description: true,
          type: true,
          confidence: true,
          reasoning: true,
          sourceInsightId: true,
        },
      }),
      prisma.decision.findMany({
        where: {
          organizationId,
          status: {
            in: ["REJECTED", "IGNORED", "COMPLETED", "SUCCESSFUL", "FAILED"],
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 8,
        select: {
          id: true,
          status: true,
          canvas: true,
          outcome: true,
          updatedAt: true,
        },
      }),
      prisma.preparedAction.findMany({
        where: { organizationId, status: { in: ["APPROVED", "DISMISSED"] } },
        orderBy: { updatedAt: "desc" },
        take: 8,
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          updatedAt: true,
        },
      }),
    ]);

  const visibleActions = collapseDuplicateActions(actions);
  const hiddenDuplicateCount = actions.length - visibleActions.length;
  const openInsights = insights.filter((item) => item.status === "NEW").length;
  const proposedDecisions = decisions.filter((item) => item.status === "PROPOSED").length;
  const activeDecisions = decisions.filter(
    (item) => item.status === "ACCEPTED" || item.status === "EXECUTED"
  ).length;
  const decisionQueue = decisions.map((decision) => {
    const canvas = readDecisionCanvas(decision.canvas);
    return {
      id: decision.id,
      status: decision.status,
      priorityScore: decision.priorityScore,
      problemStatement: canvas.problemStatement || "Untitled decision",
      recommendedDecision: canvas.recommendedDecision || "",
    };
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Atlas Brain</p>
          <h1 className="text-2xl font-bold tracking-tight">Intelligence workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review signals, decisions, outcomes, and prepared actions in one place.
          </p>
        </div>
        <Button asChild>
          <Link href="/chat?prompt=Review%20our%20open%20insights%2C%20decisions%2C%20and%20actions.%20Tell%20me%20what%20requires%20attention%20first%20and%20why.">
            Review with Atlas
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryCard label="Open insights" value={openInsights} />
        <SummaryCard label="Proposed decisions" value={proposedDecisions} />
        <SummaryCard label="Active decisions" value={activeDecisions} />
        <SummaryCard label="Prepared actions" value={visibleActions.length} />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Decisions</h2>
          <Badge variant="secondary">{decisionQueue.length} active</Badge>
        </div>
        <DecisionQueue decisions={decisionQueue} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Prepared actions</h2>
            {hiddenDuplicateCount > 0 ? (
              <p className="text-xs text-muted-foreground">
                {hiddenDuplicateCount} duplicate proposal
                {hiddenDuplicateCount === 1 ? "" : "s"} hidden.
              </p>
            ) : null}
          </div>
          <Badge variant="secondary">{visibleActions.length} pending</Badge>
        </div>
        <ActionQueue actions={visibleActions} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Recent history</h2>
            <p className="text-xs text-muted-foreground">
              Recently reviewed decisions and actions.
            </p>
          </div>
          <History className="h-5 w-5 text-muted-foreground" />
        </div>
        {decisionHistory.length === 0 && actionHistory.length === 0 ? (
          <EmptyState message="No completed or dismissed intelligence items yet." />
        ) : (
          <Card>
            <CardContent className="divide-y p-0">
              {decisionHistory.map((decision) => {
                const canvas = readDecisionCanvas(decision.canvas);
                return (
                  <HistoryRow
                    key={`decision-${decision.id}`}
                    title={canvas.problemStatement || "Untitled decision"}
                    detail={decision.outcome || "Decision review completed"}
                    status={decision.status}
                    date={decision.updatedAt}
                  />
                );
              })}
              {actionHistory.map((action) => (
                <HistoryRow
                  key={`action-${action.id}`}
                  title={action.title}
                  detail={formatStatus(action.type)}
                  status={action.status}
                  date={action.updatedAt}
                />
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Insights</h2>
          <Badge variant="secondary">{insights.length} total</Badge>
        </div>
        {insights.length === 0 ? (
          <EmptyState message="Atlas has not generated any insights yet." />
        ) : (
          insights.map((insight) => (
            <Card key={insight.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{insight.title}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {insight.category} · Priority {insight.priority}/10 · {Math.round(insight.confidence * 100)}% confidence
                    </p>
                  </div>
                  <Badge variant={insight.severity === "CRITICAL" ? "destructive" : "secondary"}>
                    {formatStatus(insight.status)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm leading-relaxed">{insight.summary || insight.description}</p>
                {insight.recommendedAction ? (
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Recommended next move
                    </p>
                    <p className="mt-1 text-sm">{insight.recommendedAction}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}

function collapseDuplicateActions<
  T extends { type: string; title: string; sourceInsightId: string | null },
>(actions: T[]): T[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const normalizedTitle = action.title.trim().toLocaleLowerCase("en-US");
    const key = `${action.sourceInsightId ?? "manual"}:${action.type}:${normalizedTitle}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <BrainCircuit className="h-5 w-5 text-primary" />
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function HistoryRow({
  title,
  detail,
  status,
  date,
}: {
  title: string;
  detail: string;
  status: string;
  date: Date;
}) {
  return (
    <div className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{detail}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {date.toLocaleDateString("en-US", {
            timeZone: "Europe/Istanbul",
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </div>
      <Badge variant="outline" className="shrink-0">
        {formatStatus(status)}
      </Badge>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-muted-foreground">
        {message}
      </CardContent>
    </Card>
  );
}

function formatStatus(value: string): string {
  return value.split("_").join(" ");
}

function readDecisionCanvas(value: unknown): {
  problemStatement?: string;
  recommendedDecision?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const record = value as Record<string, unknown>;
  return {
    problemStatement:
      typeof record.problemStatement === "string" ? record.problemStatement : undefined,
    recommendedDecision:
      typeof record.recommendedDecision === "string"
        ? record.recommendedDecision
        : undefined,
  };
}
