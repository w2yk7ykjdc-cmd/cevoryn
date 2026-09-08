export const RULE_NAME = "high_value_stalled_lead";
export const RULE_VERSION = "v1";

// Reused verbatim from `src/server/leads/analysis.ts`'s `STALE_AFTER_DAYS` —
// the same, already-justified definition of "stale" a lead detail page's
// AI analysis already uses. `SEVERE_AFTER_DAYS` scales off that same
// constant rather than introducing an unrelated number.
const STALE_AFTER_DAYS = 7;
const SEVERE_AFTER_DAYS = STALE_AFTER_DAYS * 2;

export type StalledLeadCandidate = {
  id: string;
  value: number;
  createdAt: Date;
  isWon: boolean;
  isLost: boolean;
  /** Most recent `LeadActivity.createdAt` for this lead, or `null` if none exist. */
  lastActivityAt: Date | null;
};

export type HighValueStalledLeadEvaluation = {
  severity: "medium" | "high";
  confidence: number;
  evidence: {
    daysSinceLastActivity: number;
    leadValue: number;
    orgMedianOpenValue: number;
    hasActivityHistory: boolean;
  };
};

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));
}

/**
 * Deterministic, rule-based detection — no LLM call, fully unit-testable.
 *
 * "Stalled": `daysSinceLastActivity > STALE_AFTER_DAYS` and the lead isn't
 * won or lost — identical to `analyzeLead()`'s "isStale" definition
 * (`src/server/leads/analysis.ts`), including its fallback to `createdAt`
 * when a lead has no recorded activity at all.
 *
 * "High value": there is no existing absolute-dollar threshold anywhere in
 * the codebase to reuse, and picking an arbitrary fixed number would be
 * meaningless across organizations of very different sizes. Instead, a lead
 * counts as high-value when its value is above *this organization's own*
 * median value among its currently open (not won/lost) leads — relative,
 * per-org, and still fully deterministic and explainable ("above your own
 * median deal size").
 *
 * `confidence` reflects data quality, not the strength of the pattern: 90
 * when the lead has at least one recorded activity (a real, measured
 * staleness), 60 when it doesn't (the measurement fell back to `createdAt`,
 * the same edge case `analyzeLead()` already has to handle).
 */
export function evaluateHighValueStalledLead(
  lead: StalledLeadCandidate,
  orgMedianOpenValue: number,
  now: Date = new Date(),
): HighValueStalledLeadEvaluation | null {
  if (lead.isWon || lead.isLost) return null;

  const hasActivityHistory = lead.lastActivityAt !== null;
  const effectiveLastActivityAt = lead.lastActivityAt ?? lead.createdAt;
  const daysSinceLastActivity = daysBetween(effectiveLastActivityAt, now);

  const isStale = daysSinceLastActivity > STALE_AFTER_DAYS;
  const isHighValue = lead.value > orgMedianOpenValue;
  if (!isStale || !isHighValue) return null;

  return {
    severity: daysSinceLastActivity > SEVERE_AFTER_DAYS ? "high" : "medium",
    confidence: hasActivityHistory ? 90 : 60,
    evidence: {
      daysSinceLastActivity,
      leadValue: lead.value,
      orgMedianOpenValue,
      hasActivityHistory,
    },
  };
}

/** Deterministic median of open-lead values — sorted, no external dependency. */
export function medianOpenLeadValue(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const lower = sorted[mid - 1] ?? 0;
    const upper = sorted[mid] ?? 0;
    return (lower + upper) / 2;
  }
  return sorted[mid] ?? 0;
}
