"use client";

import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { handleUnauthorized } from "@/lib/client-auth";

export interface OpportunityCardData {
  id: string;
  polarity: "OPPORTUNITY" | "THREAT";
  title: string;
  description: string;
  estimatedValueMin: number | null;
  estimatedValueMax: number | null;
  currency: string;
  probability: number;
  confidence: number;
  timeHorizon: string;
  reasoning: string;
  recommendedAction: string;
  evidence: unknown;
  score: number;
  scoreBreakdown: unknown;
  status: string;
  externalEntity: { id: string; name: string };
  latestResearchTask?: {
    id: string;
    status: string;
    brief: string | null;
    error: string | null;
  } | null;
}

function formatValueRange(
  min: number | null,
  max: number | null,
  currency: string
): string | null {
  if (min === null && max === null) return null;
  const format = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  if (min !== null && max !== null) return `${format(min)} – ${format(max)}`;
  return format(min ?? max ?? 0);
}

function asEvidenceList(
  value: unknown
): Array<{ label: string; sourceUrl?: string; excerpt?: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is { label: string; sourceUrl?: string; excerpt?: string } =>
      !!item &&
      typeof item === "object" &&
      typeof (item as { label?: unknown }).label === "string"
  );
}

function asScoreBreakdown(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number"
  );
  return Object.fromEntries(entries);
}

export function OpportunityCard({
  opportunity,
  canManage,
}: {
  opportunity: OpportunityCardData;
  canManage: boolean;
}) {
  const t = useTranslations("radar");
  const [status, setStatus] = useState(opportunity.status);
  const [expanded, setExpanded] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isResearching, setIsResearching] = useState(false);
  const [researchTask, setResearchTask] = useState(
    opportunity.latestResearchTask ?? null
  );
  const researchInFlight =
    researchTask?.status === "PENDING" || researchTask?.status === "RUNNING";

  const evidence = asEvidenceList(opportunity.evidence);
  const breakdown = asScoreBreakdown(opportunity.scoreBreakdown);
  const valueRange = formatValueRange(
    opportunity.estimatedValueMin,
    opportunity.estimatedValueMax,
    opportunity.currency
  );
  const isThreat = opportunity.polarity === "THREAT";

  async function updateStatus(
    next: "QUALIFIED" | "ACTED_ON" | "WON" | "LOST" | "DISMISSED"
  ) {
    setIsUpdating(true);
    try {
      const response = await fetch(
        `/api/radar/opportunities/${opportunity.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        }
      );
      if (handleUnauthorized(response)) return;
      if (!response.ok) throw new Error(t("statusUpdateFailed"));

      setStatus(next);
      toast.success(t("statusUpdated"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("statusUpdateFailed")
      );
    } finally {
      setIsUpdating(false);
    }
  }

  async function startResearch() {
    setIsResearching(true);
    try {
      const response = await fetch(
        `/api/radar/opportunities/${opportunity.id}/research`,
        { method: "POST" }
      );
      if (handleUnauthorized(response)) return;
      if (!response.ok) throw new Error(t("researchFailed"));

      const data = await response.json().catch(() => null);
      setResearchTask({
        id: data?.data?.taskId ?? "",
        status: "PENDING",
        brief: null,
        error: null,
      });
      toast.success(t("researchStarted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("researchFailed"));
    } finally {
      setIsResearching(false);
    }
  }

  return (
    <Card className={isThreat ? "border-destructive/30" : undefined}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{opportunity.title}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {opportunity.externalEntity.name} · {t("confidence")}{" "}
              {Math.round(opportunity.confidence * 100)}%
            </p>
          </div>
          <Badge variant={isThreat ? "destructive" : "secondary"}>
            {status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm leading-relaxed">{opportunity.description}</p>

        {opportunity.recommendedAction ? (
          <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-primary">
                {t("recommendedAction")}
              </p>
              <p className="mt-0.5">{opportunity.recommendedAction}</p>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-3 text-xs sm:grid-cols-4">
          {valueRange ? (
            <div>
              <p className="font-medium text-muted-foreground">
                {t("estimatedValue")}
              </p>
              <p className="font-semibold">{valueRange}</p>
            </div>
          ) : null}
          <div>
            <p className="font-medium text-muted-foreground">
              {t("probability")}
            </p>
            <p className="font-semibold">
              {Math.round(opportunity.probability * 100)}%
            </p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">
              {t("timeHorizon")}
            </p>
            <p className="font-semibold">{opportunity.timeHorizon}</p>
          </div>
          <div>
            <p className="font-medium text-muted-foreground">Score</p>
            <p className="font-semibold">
              {Math.round(opportunity.score * 100)}
            </p>
          </div>
        </div>

        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`opportunity-detail-${opportunity.id}`}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          {t("whyItMatters")}
        </button>

        {expanded ? (
          <div
            id={`opportunity-detail-${opportunity.id}`}
            className="space-y-3 rounded-lg border p-3 text-xs"
          >
            <p>{opportunity.reasoning}</p>

            {Object.keys(breakdown).length > 0 ? (
              <div>
                <p className="mb-1 font-medium uppercase tracking-wide text-muted-foreground">
                  {t("scoreBreakdown")}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                  {Object.entries(breakdown).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{key}</span>
                      <span className="font-medium">
                        {Math.round(value * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {evidence.length > 0 ? (
              <div>
                <p className="mb-1 font-medium uppercase tracking-wide text-muted-foreground">
                  {t("evidence")}
                </p>
                <ul className="space-y-1">
                  {evidence.map((item, index) => (
                    <li key={index}>
                      {item.sourceUrl ? (
                        <a
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          {item.label}
                        </a>
                      ) : (
                        <span>{item.label}</span>
                      )}
                      {item.excerpt ? (
                        <span className="text-muted-foreground">
                          {" "}
                          — {item.excerpt}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {researchTask?.status === "COMPLETED" && researchTask.brief ? (
              <div>
                <p className="mb-1 font-medium uppercase tracking-wide text-muted-foreground">
                  {t("researchBrief")}
                </p>
                <p className="whitespace-pre-wrap">{researchTask.brief}</p>
              </div>
            ) : researchInFlight ? (
              <p className="text-muted-foreground">{t("researchPending")}</p>
            ) : researchTask?.status === "FAILED" ? (
              <p className="text-destructive">
                {researchTask.error || t("researchFailed")}
              </p>
            ) : null}
          </div>
        ) : null}

        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={isResearching || researchInFlight}
              onClick={startResearch}
            >
              {isResearching || researchInFlight ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {researchInFlight ? t("researchPending") : t("investigate")}
            </Button>
            {status === "NEW" || status === "REVIEWING" ? (
              <Button
                size="sm"
                disabled={isUpdating}
                onClick={() => updateStatus("QUALIFIED")}
              >
                {isUpdating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {t("qualify")}
              </Button>
            ) : null}
            {status === "QUALIFIED" ? (
              <>
                <Button
                  size="sm"
                  disabled={isUpdating}
                  onClick={() => updateStatus("WON")}
                >
                  {t("markWon")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isUpdating}
                  onClick={() => updateStatus("LOST")}
                >
                  {t("markLost")}
                </Button>
              </>
            ) : null}
            {status !== "DISMISSED" ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={isUpdating}
                onClick={() => updateStatus("DISMISSED")}
              >
                <X className="h-4 w-4" />
                {t("dismiss")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
