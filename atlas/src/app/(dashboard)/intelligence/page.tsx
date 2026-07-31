import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getHistoryVisibility,
  matchesInsightFilter,
  readHistoryFilter,
  readInsightFilter,
} from "@/features/brain/intelligence/filtering";
import { requireMembership, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";

import { ActionQueue } from "./action-queue";
import { DecisionQueue } from "./decision-queue";
import { HistoryActionButton } from "./history-action-button";

export const metadata: Metadata = { title: "Intelligence — CEVORYN" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function IntelligencePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = await getTranslations("intelligence");
  const locale = await getLocale();
  const user = await requireUser();
  const membership = await requireMembership(user.id);
  const organizationId = membership.organizationId;
  const params = await searchParams;
  const insightFilter = readInsightFilter(first(params.insight));
  const historyFilter = readHistoryFilter(first(params.history));

  const [insights, decisions, actions, decisionHistory, actionHistory] =
    await Promise.all([
      prisma.insight.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.decision.findMany({
        where: {
          organizationId,
          status: { in: ["PROPOSED", "ACCEPTED", "EXECUTED"] },
        },
        orderBy: [{ priorityScore: "desc" }, { createdAt: "desc" }],
        take: 20,
      }),
      prisma.preparedAction.findMany({
        where: { organizationId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.decision.findMany({
        where: {
          organizationId,
          status: {
            in: ["REJECTED", "IGNORED", "COMPLETED", "SUCCESSFUL", "FAILED"],
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 12,
      }),
      prisma.preparedAction.findMany({
        where: { organizationId, status: { in: ["APPROVED", "DISMISSED"] } },
        orderBy: { updatedAt: "desc" },
        take: 12,
      }),
    ]);

  const visibleActions = collapseDuplicateActions(actions);
  const visibleInsights = insights.filter((item) =>
    matchesInsightFilter(item, insightFilter)
  );
  const history = getHistoryVisibility(historyFilter);
  const decisionQueue = decisions.map((decision) => {
    const canvas = readCanvas(decision.canvas);
    return {
      id: decision.id,
      status: decision.status,
      priorityScore: decision.priorityScore,
      problemStatement: canvas.problemStatement || t("untitledDecision"),
      recommendedDecision: canvas.recommendedDecision || "",
    };
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{t("eyebrow")}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("subheading")}
          </p>
        </div>
        <Button asChild>
          <Link href={`/chat?prompt=${encodeURIComponent(t("reviewPrompt"))}`}>
            {t("reviewWithCevoryn")} <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric
          label={t("metrics.openInsights")}
          value={insights.filter((item) => item.status === "NEW").length}
        />
        <Metric
          label={t("metrics.proposedDecisions")}
          value={decisions.filter((item) => item.status === "PROPOSED").length}
        />
        <Metric
          label={t("metrics.activeDecisions")}
          value={decisions.filter((item) => item.status !== "PROPOSED").length}
        />
        <Metric
          label={t("metrics.preparedActions")}
          value={visibleActions.length}
        />
      </div>

      <Section
        title={t("decisionsSection")}
        badge={t("activeCount", { count: decisionQueue.length })}
      >
        <DecisionQueue decisions={decisionQueue} />
      </Section>

      <Section
        title={t("preparedActionsSection")}
        badge={t("pendingCount", { count: visibleActions.length })}
      >
        <ActionQueue actions={visibleActions} />
      </Section>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t("recentHistory")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("recentHistorySubtitle")}
            </p>
          </div>
          <Filters
            name="history"
            active={historyFilter}
            values={["all", "decisions", "actions"]}
            preserve={{ insight: insightFilter }}
            t={t}
          />
        </div>
        <Card>
          <CardContent className="divide-y p-0">
            {history.showDecisions &&
              decisionHistory.map((item) => {
                const canvas = readCanvas(item.canvas);
                return (
                  <HistoryRow
                    key={item.id}
                    title={canvas.problemStatement || t("untitledDecision")}
                    detail={item.outcome || t("decisionReviewCompleted")}
                    status={item.status}
                    date={item.updatedAt}
                    locale={locale}
                  />
                );
              })}
            {history.showActions &&
              actionHistory.map((item) => (
                <HistoryRow
                  key={item.id}
                  title={item.title}
                  detail={format(item.type)}
                  status={item.status}
                  date={item.updatedAt}
                  locale={locale}
                  action={
                    item.status === "APPROVED" ? (
                      <HistoryActionButton
                        id={item.id}
                        type={item.type}
                        title={item.title}
                        description={item.description}
                      />
                    ) : null
                  }
                />
              ))}
            {(!history.showDecisions || decisionHistory.length === 0) &&
            (!history.showActions || actionHistory.length === 0) ? (
              <Empty text={t("noMatchingHistory")} />
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t("insightsSection")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("insightsShowing", {
                shown: visibleInsights.length,
                total: insights.length,
              })}
            </p>
          </div>
          <Filters
            name="insight"
            active={insightFilter}
            values={["all", "open", "critical"]}
            preserve={{ history: historyFilter }}
            t={t}
          />
        </div>
        {visibleInsights.length === 0 ? (
          <Card>
            <Empty text={t("noInsightsMatch")} />
          </Card>
        ) : (
          visibleInsights.map((item) => (
            <Card key={item.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{item.title}</CardTitle>
                  <Badge
                    variant={
                      item.severity === "CRITICAL" ? "destructive" : "secondary"
                    }
                  >
                    {format(item.status)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">{item.summary || item.description}</p>
                {item.recommendedAction ? (
                  <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                    <strong>{t("recommendedNextMove")}</strong>{" "}
                    {item.recommendedAction}
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

function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Badge variant="secondary">{badge}</Badge>
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

type IntelligenceTranslator = Awaited<ReturnType<typeof getTranslations>>;

function Filters({
  name,
  active,
  values,
  preserve,
  t,
}: {
  name: string;
  active: string;
  values: string[];
  preserve: Record<string, string>;
  t: IntelligenceTranslator;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border bg-muted/30 p-1">
      {values.map((value) => {
        const query = new URLSearchParams({ ...preserve, [name]: value });
        return (
          <Link
            key={value}
            href={`/intelligence?${query.toString()}`}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-medium",
              active === value
                ? "bg-background shadow-sm"
                : "text-muted-foreground"
            )}
          >
            {t(`filters.${value}` as "filters.all")}
          </Link>
        );
      })}
    </div>
  );
}

function HistoryRow({
  title,
  detail,
  status,
  date,
  action,
  locale,
}: {
  title: string;
  detail: string;
  status: string;
  date: Date;
  action?: React.ReactNode;
  locale: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {date.toLocaleDateString(locale, { timeZone: "Europe/Istanbul" })}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge variant="outline">{format(status)}</Badge>
        {action}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="py-8 text-center text-sm text-muted-foreground">{text}</div>
  );
}
function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
function format(value: string) {
  return value.split("_").join(" ");
}
function collapseDuplicateActions<
  T extends { type: string; title: string; sourceInsightId: string | null },
>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.sourceInsightId ?? "manual"}:${item.type}:${item.title.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function readCanvas(value: unknown): {
  problemStatement?: string;
  recommendedDecision?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    problemStatement:
      typeof record.problemStatement === "string"
        ? record.problemStatement
        : undefined,
    recommendedDecision:
      typeof record.recommendedDecision === "string"
        ? record.recommendedDecision
        : undefined,
  };
}
