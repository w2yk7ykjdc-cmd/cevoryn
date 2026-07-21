import { ArrowRight, BrainCircuit, CheckCircle2, CircleAlert, Scale } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMembership, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Intelligence — Atlas" };

export default async function IntelligencePage() {
  const user = await requireUser();
  const membership = await requireMembership(user.id);
  const organizationId = membership.organizationId;

  const [insights, decisions] = await Promise.all([
    prisma.insight.findMany({
      where: { organizationId },
      orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
      take: 20,
    }),
    prisma.decision.findMany({
      where: { organizationId },
      orderBy: [{ status: "asc" }, { priorityScore: "desc" }, { createdAt: "desc" }],
      take: 20,
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
            Review what Atlas detected, decide what matters, and move the company forward.
          </p>
        </div>
        <Link href="/chat?prompt=Review%20our%20open%20insights%20and%20decisions.%20Tell%20me%20what%20requires%20attention%20first%20and%20why.">
          <Button>
            Review with Atlas
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Open insights" value={openInsights} icon={CircleAlert} />
        <SummaryCard label="Decisions pending" value={openDecisions} icon={Scale} />
        <SummaryCard
          label="Resolved items"
          value={
            insights.filter((item) => ["ACTED_ON", "DISMISSED"].includes(item.status)).length +
            decisions.filter((item) =>
              ["COMPLETED", "SUCCESSFUL", "REJECTED", "FAILED"].includes(item.status)
            ).length
          }
          icon={CheckCircle2}
        />
      </div>

      <section className="space-y-3" aria-labelledby="insights-heading">
        <div className="flex items-center justify-between">
          <h2 id="insights-heading" className="text-lg font-semibold">Insights</h2>
          <Badge variant="secondary">{insights.length} total</Badge>
        </div>

        {insights.length === 0 ? (
          <EmptyState
            title="No insights yet"
            description="Atlas will surface patterns after it has enough company conversations and activity."
          />
        ) : (
          <div className="space-y-3">
            {insights.map((insight) => (
              <Card key={insight.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{insight.title}</CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {insight.category} · Priority {insight.priority}/10 · {Math.round(insight.confidence * 100)}% confidence
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <Badge variant={insight.severity === "CRITICAL" ? "destructive" : "outline"}>
                        {insight.severity}
                      </Badge>
                      <Badge variant="secondary">{insight.status.replaceAll("_", " ")}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm leading-relaxed">{insight.summary || insight.description}</p>
                  {insight.recommendedAction && (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-primary">Next move</p>
                      <p className="mt-1 text-sm">{insight.recommendedAction}</p>
                    </div>
                  )}
                  <Link
                    href={`/chat?prompt=${encodeURIComponent(`Analyze this insight and give me a concrete decision: ${insight.title}. Context: ${insight.summary || insight.description}`)}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    Discuss this insight <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="decisions-heading">
        <div className="flex items-center justify-between">
          <h2 id="decisions-heading" className="text-lg font-semibold">Decisions</h2>
          <Badge variant="secondary">{decisions.length} total</Badge>
        </div>

        {decisions.length === 0 ? (
          <EmptyState
            title="No decisions yet"
            description="When Atlas identifies a decision worth formalizing, it will appear here."
          />
        ) : (
          <div className="space-y-3">
            {decisions.map((decision) => {
              const canvas = asDecisionCanvas(decision.canvas);
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
                      <Badge variant={decision.status === "PROPOSED" ? "default" : "secondary"}>
                        {decision.status.replaceAll("_", " ")}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {canvas.executiveSummary && (
                      <p className="text-sm leading-relaxed">{canvas.executiveSummary}</p>
                    )}
                    {canvas.recommendedDecision && (
                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-primary">Recommendation</p>
                        <p className="mt-1 text-sm">{canvas.recommendedDecision}</p>
                      </div>
                    )}
                    <Link
                      href={`/chat?prompt=${encodeURIComponent(`Help me decide this: ${canvas.problemStatement || "Untitled decision"}. Atlas recommendation: ${canvas.recommendedDecision || "No recommendation yet"}`)}`}
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      Work through decision <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof BrainCircuit;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
        <BrainCircuit className="h-6 w-6 text-muted-foreground" />
        <p className="font-medium">{title}</p>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function asDecisionCanvas(value: unknown): {
  problemStatement?: string;
  executiveSummary?: string;
  recommendedDecision?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    problemStatement:
      typeof record.problemStatement === "string" ? record.problemStatement : undefined,
    executiveSummary:
      typeof record.executiveSummary === "string" ? record.executiveSummary : undefined,
    recommendedDecision:
      typeof record.recommendedDecision === "string" ? record.recommendedDecision : undefined,
  };
}
