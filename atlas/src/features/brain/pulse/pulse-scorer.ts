import type { PulseMetrics } from "../core/types";

export interface PulseScore {
  score: number;
  trend: "improving" | "stable" | "declining";
  dimensions: PulseDimension[];
  topContributors: PulseContributor[];
}

export interface PulseDimension {
  name: string;
  score: number;
  weight: number;
  description: string;
}

export interface PulseContributor {
  factor: string;
  impact: "positive" | "negative" | "neutral";
  value: string;
}

/**
 * Compute a 0-100 pulse score from raw metrics.
 *
 * Dimensions:
 * - Engagement (40%): conversations + messages per team member
 * - Velocity (30%): response time efficiency
 * - Coverage (30%): how much of the team is active
 *
 * Each dimension scores 0-100, then weighted average.
 */
export function computePulseScore(
  current: PulseMetrics,
  previous: PulseMetrics | null
): PulseScore {
  const engagement = scoreEngagement(current);
  const velocity = scoreVelocity(current);
  const coverage = scoreCoverage(current);

  const dimensions: PulseDimension[] = [
    {
      name: "Engagement",
      score: engagement,
      weight: 0.4,
      description: `${current.conversationCount} conversations, ${current.messageCount} messages`,
    },
    {
      name: "Velocity",
      score: velocity,
      weight: 0.3,
      description: `${current.avgResponseTimeMs}ms avg response`,
    },
    {
      name: "Coverage",
      score: coverage,
      weight: 0.3,
      description: `${current.activeUserCount} active member${current.activeUserCount === 1 ? "" : "s"}`,
    },
  ];

  const score = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0)
  );

  const trend = computeTrend(score, previous);
  const topContributors = identifyContributors(current, dimensions);

  return { score, trend, dimensions, topContributors };
}

function scoreEngagement(metrics: PulseMetrics): number {
  // Base: 1 conversation = 20 points, up to 100
  const convScore = Math.min(metrics.conversationCount * 20, 100);
  // Messages: 10 messages = 50 points, up to 100
  const msgScore = Math.min(metrics.messageCount * 5, 100);
  return Math.round((convScore + msgScore) / 2);
}

function scoreVelocity(metrics: PulseMetrics): number {
  if (metrics.avgResponseTimeMs === 0) return 50; // No data
  // Under 2s = 100, under 5s = 70, under 10s = 40, over 10s = 20
  if (metrics.avgResponseTimeMs < 2000) return 100;
  if (metrics.avgResponseTimeMs < 5000) return 70;
  if (metrics.avgResponseTimeMs < 10000) return 40;
  return 20;
}

function scoreCoverage(metrics: PulseMetrics): number {
  if (metrics.activeUserCount === 0) return 0;
  // 1 user = 30, 2 = 60, 3+ = 80+
  return Math.min(metrics.activeUserCount * 30, 100);
}

function computeTrend(
  currentScore: number,
  previous: PulseMetrics | null
): "improving" | "stable" | "declining" {
  if (!previous) return "stable";

  const prevScore = computePulseScore(previous, null).score;
  const delta = currentScore - prevScore;

  if (delta > 5) return "improving";
  if (delta < -5) return "declining";
  return "stable";
}

function identifyContributors(
  metrics: PulseMetrics,
  dimensions: PulseDimension[]
): PulseContributor[] {
  const contributors: PulseContributor[] = [];

  // Find strongest and weakest dimensions
  const sorted = [...dimensions].sort((a, b) => b.score - a.score);

  if (sorted[0] && sorted[0].score > 60) {
    contributors.push({
      factor: sorted[0].name,
      impact: "positive",
      value: sorted[0].description,
    });
  }

  const weakest = sorted[sorted.length - 1];
  if (weakest && weakest.score < 40) {
    contributors.push({
      factor: weakest.name,
      impact: "negative",
      value: weakest.description,
    });
  }

  if (metrics.tokenUsage.total > 100000) {
    contributors.push({
      factor: "AI Usage",
      impact: "neutral",
      value: `${metrics.tokenUsage.total.toLocaleString()} tokens consumed`,
    });
  }

  return contributors;
}
