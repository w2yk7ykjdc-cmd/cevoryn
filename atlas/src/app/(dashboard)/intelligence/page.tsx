import { ArrowRight, BrainCircuit } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMembership, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Intelligence — Atlas" };
export const dynamic = "force-dynamic";

export default async function IntelligencePage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);
  const organizationId = membership.organizationId;

  const [insights, decisions] = await Promise.all([
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
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        priorityScore: true,
        canvas: true,
      },
    }),
  ]);

  const openInsights = insights.filter((item) => item.status === "NEW").length;
  const openDecisions = decisions.filter((item) => item.status === "PROPOSED").length;

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Atlas Brain</p>
          <h1 className="text-2xl font-bold tracking-tight">Intelligence workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review signals and decisions that may require attention.
          </p>
        </div>
        <Button asChild>
          <Link href="/chat?prompt=Review%20our%20open%20insights%20and%20decisions.%20Tell%20me%20what%20requires%20attention%20first%20and%20why.">
            Review with Atlas
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryCard label="Open insights" value={openInsights} />
        <SummaryCard label="Pending decisions" value={openDecisions} />
      </div>

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

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Decisions</h2>
          <Badge variant="secondary">{decisions.length} total</Badge>
        </div>
        {decisions.length === 0 ? (
          <EmptyState message="Atlas has not formalized any decisions yet." />
        ) : (
          decisions.map((decision) => {
            const canvas = readDecisionCanvas(decision.canvas);
            return (
              <Card key={decision.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">
                        {canvas.problemStatement || "Untitled decision"}
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Priority {decision.priorityScore.toFixed(1)}/10
                      </p>
                    </div>
                    <Badge variant="secondary">{formatStatus(decision.status)}</Badge>
                  </div>
                </CardHeader>
                {canvas.recommendedDecision ? (
                  <CardContent>
                    <p className="text-sm leading-relaxed">{canvas.recommendedDecision}</p>
                  </CardContent>
                ) : null}
              </Card>
            );
          })
        )}
      </section>
    </div>
  );
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
