const STALE_AFTER_DAYS = 7;
const AGING_AFTER_DAYS = 3;

export type LeadAnalysisInput = {
  title: string;
  value: number;
  probability: number;
  createdAt: Date;
  stage: { name: string; isWon: boolean; isLost: boolean };
  activities: { createdAt: Date }[];
  tasks: { status: string; dueDate: Date | null }[];
};

export type RiskLevel = "low" | "medium" | "high";

export type LeadAnalysis = {
  daysInPipeline: number;
  daysSinceLastActivity: number;
  openTaskCount: number;
  overdueTaskCount: number;
  riskLevel: RiskLevel;
  suggestedNextAction: string;
  summary: string;
};

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));
}

/**
 * Deterministic, rule-based lead analysis — no LLM call inside this
 * function. The AI Runtime's `analyze_lead` tool exposes this to the model
 * as a fact-finding step; the model then decides what to say or do with
 * the result. Keeping the analysis itself deterministic means it's fully
 * unit-testable and reproducible, independent of any AI provider.
 */
export function analyzeLead(lead: LeadAnalysisInput, now: Date = new Date()): LeadAnalysis {
  const daysInPipeline = daysBetween(lead.createdAt, now);

  const lastActivityAt = lead.activities.reduce<Date>(
    (latest, activity) => (activity.createdAt > latest ? activity.createdAt : latest),
    lead.createdAt,
  );
  const daysSinceLastActivity = daysBetween(lastActivityAt, now);

  const openTasks = lead.tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const overdueTasks = openTasks.filter((t) => t.dueDate && t.dueDate < now);

  const isClosed = lead.stage.isWon || lead.stage.isLost;
  const isStale = daysSinceLastActivity > STALE_AFTER_DAYS;

  let riskLevel: RiskLevel = "low";
  if (!isClosed) {
    if (isStale || overdueTasks.length > 0) {
      riskLevel = "high";
    } else if (daysSinceLastActivity > AGING_AFTER_DAYS) {
      riskLevel = "medium";
    }
  }

  let suggestedNextAction: string;
  if (isClosed) {
    suggestedNextAction = lead.stage.isWon
      ? "Deal is won — no further action needed on this lead."
      : "Deal is lost — no further action needed unless re-engaging later.";
  } else if (overdueTasks.length > 0) {
    suggestedNextAction = `Resolve ${overdueTasks.length} overdue task(s) on this lead before doing anything else.`;
  } else if (isStale) {
    suggestedNextAction = `No activity in ${daysSinceLastActivity} days — follow up with a call or email to re-engage.`;
  } else if (openTasks.length === 0) {
    suggestedNextAction = "No open tasks — schedule a concrete next step to keep the deal moving.";
  } else {
    suggestedNextAction = `On track — ${openTasks.length} task(s) open, continue with the next scheduled step.`;
  }

  const summary =
    `"${lead.title}" is a $${lead.value.toLocaleString()} deal at ${lead.probability}% probability, ` +
    `currently in the "${lead.stage.name}" stage. Created ${daysInPipeline} day(s) ago, last activity ` +
    `${daysSinceLastActivity} day(s) ago. ${openTasks.length} open task(s)` +
    (overdueTasks.length > 0 ? ` (${overdueTasks.length} overdue).` : ".");

  return {
    daysInPipeline,
    daysSinceLastActivity,
    openTaskCount: openTasks.length,
    overdueTaskCount: overdueTasks.length,
    riskLevel,
    suggestedNextAction,
    summary,
  };
}
