"use client";

import { AlertTriangle, ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sendAnalyticsEvent } from "@/lib/analytics";

import type { TopPriorityItem } from "../types";

import { TrustDisclosure } from "./trust-disclosure";

interface TopPriorityProps {
  item: TopPriorityItem;
  onApproveAction?: () => void;
}

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: "border-red-200 dark:border-red-900/50",
  WARNING: "border-amber-200 dark:border-amber-900/50",
  SUGGESTION: "border-blue-200 dark:border-blue-900/50",
  INFO: "",
};

export function TopPriority({ item, onApproveAction }: TopPriorityProps) {
  function handleOpen() {
    sendAnalyticsEvent("top_priority_opened", { id: item.id });
  }

  return (
    <Card
      className={SEVERITY_STYLES[item.severity] ?? ""}
      onClick={handleOpen}
      role="article"
      aria-label={`Top priority: ${item.title}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle
              className="h-4 w-4 shrink-0 text-amber-500"
              aria-hidden="true"
            />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Top Priority
            </span>
          </div>
          <div className="flex gap-1.5">
            <Badge variant="outline" className="text-xs">
              {item.category}
            </Badge>
            <Badge
              variant={
                item.severity === "CRITICAL" ? "destructive" : "secondary"
              }
              className="text-xs"
            >
              {item.severity}
            </Badge>
          </div>
        </div>
        <CardTitle className="mt-2 text-lg leading-tight">
          {item.title}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summary */}
        <p className="text-sm leading-relaxed">
          {item.summary || item.description}
        </p>

        {/* Impact */}
        {item.impact && (
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Business Impact
            </p>
            <p className="text-sm">{item.impact}</p>
          </div>
        )}

        {/* Recommended action */}
        {item.recommendedAction && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-primary">
              Recommended Action
            </p>
            <p className="text-sm">{item.recommendedAction}</p>
            {onApproveAction && (
              <Button
                size="sm"
                className="mt-3"
                onClick={(e) => {
                  e.stopPropagation();
                  onApproveAction();
                }}
              >
                Take Action
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}

        {/* Trust disclosure */}
        <TrustDisclosure
          confidence={item.confidence}
          reasoning={item.reasoning}
          evidence={item.evidence}
          missingInformation={item.missingInformation}
        />
      </CardContent>
    </Card>
  );
}
