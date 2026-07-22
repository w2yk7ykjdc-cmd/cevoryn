export type InsightFilter = "all" | "open" | "critical";
export type HistoryFilter = "all" | "decisions" | "actions";

export function readInsightFilter(value: string | undefined): InsightFilter {
  return value === "open" || value === "critical" ? value : "all";
}

export function readHistoryFilter(value: string | undefined): HistoryFilter {
  return value === "decisions" || value === "actions" ? value : "all";
}

export function matchesInsightFilter(
  insight: { status: string; severity: string },
  filter: InsightFilter
): boolean {
  if (filter === "open") return insight.status === "NEW";
  if (filter === "critical") return insight.severity === "CRITICAL";
  return true;
}

export function getHistoryVisibility(filter: HistoryFilter): {
  showDecisions: boolean;
  showActions: boolean;
} {
  return {
    showDecisions: filter !== "actions",
    showActions: filter !== "decisions",
  };
}
