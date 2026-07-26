import "server-only";

import type { Evidence, TrustEnvelope } from "./types";

/**
 * Trust Engine — ensures every recommendation is explainable.
 *
 * Responsibilities:
 * 1. Compute confidence scores from evidence weight
 * 2. Identify missing information
 * 3. Wrap all outputs in TrustEnvelopes
 *
 * CEVORYN NEVER presents uncertain conclusions as facts.
 */

/**
 * Wrap any data in a TrustEnvelope with computed confidence.
 */
export function createTrustEnvelope<T>(params: {
  data: T;
  evidence: Evidence[];
  reasoning: string;
  missingInformation?: string[];
  alternativeExplanations?: string[];
  dataWindowHours?: number;
}): TrustEnvelope<T> {
  const confidence = computeConfidence(params.evidence);

  const freshness =
    params.dataWindowHours !== undefined
      ? `Last ${params.dataWindowHours} hours`
      : "Unknown";

  return {
    data: params.data,
    confidence,
    reasoning: params.reasoning,
    evidence: params.evidence,
    missingInformation: params.missingInformation ?? detectMissingInfo(),
    alternativeExplanations: params.alternativeExplanations ?? [],
    dataFreshness: freshness,
  };
}

/**
 * Compute a confidence score from weighted evidence.
 *
 * Algorithm:
 * - Sum evidence weights (each 0-1)
 * - Diminishing returns: more evidence helps but doesn't guarantee certainty
 * - Minimum evidence threshold: fewer than 2 pieces → capped at 0.4
 * - Maximum: asymptotically approaches 0.95 (never 1.0)
 */
function computeConfidence(evidence: Evidence[]): number {
  if (evidence.length === 0) return 0.1;

  const totalWeight = evidence.reduce((sum, e) => sum + e.weight, 0);
  const avgWeight = totalWeight / evidence.length;

  // Sigmoid-like function: more evidence → higher confidence, never reaches 1.0
  const evidenceBonus = 1 - 1 / (1 + evidence.length * 0.3);
  const raw = avgWeight * 0.6 + evidenceBonus * 0.4;

  // Cap at 0.4 if fewer than 2 evidence pieces
  if (evidence.length < 2) return Math.min(raw, 0.4);

  // Cap at 0.95 — CEVORYN never claims absolute certainty
  return Math.min(raw, 0.95);
}

/**
 * Detect common missing information sources.
 * In production, this checks which data connectors are active.
 */
function detectMissingInfo(): string[] {
  const missing: string[] = [];

  // These represent data sources CEVORYN could use but doesn't have yet
  missing.push("Calendar integration not connected");
  missing.push("Task management system not connected");
  missing.push("Email integration not connected");

  return missing;
}

/**
 * Create evidence from a conversation message.
 */
export function conversationEvidence(
  conversationId: string,
  excerpt: string,
  timestamp: string,
  weight: number = 0.6
): Evidence {
  return {
    source: "conversation",
    sourceId: conversationId,
    excerpt: excerpt.slice(0, 300),
    timestamp,
    weight: Math.max(0, Math.min(1, weight)),
  };
}

/**
 * Create evidence from a stored memory.
 */
export function memoryEvidence(
  memoryId: string,
  content: string,
  timestamp: string,
  weight: number = 0.7
): Evidence {
  return {
    source: "memory",
    sourceId: memoryId,
    excerpt: content.slice(0, 300),
    timestamp,
    weight: Math.max(0, Math.min(1, weight)),
  };
}

/**
 * Create evidence from a pulse metric.
 */
export function pulseEvidence(
  snapshotId: string,
  description: string,
  timestamp: string,
  weight: number = 0.5
): Evidence {
  return {
    source: "pulse",
    sourceId: snapshotId,
    excerpt: description,
    timestamp,
    weight: Math.max(0, Math.min(1, weight)),
  };
}
