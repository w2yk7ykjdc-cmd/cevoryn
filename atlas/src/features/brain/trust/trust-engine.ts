import "server-only";

import { countGoogleConnections } from "@/lib/google-connection";

import { computeConfidence } from "./trust-math";
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
export async function createTrustEnvelope<T>(params: {
  data: T;
  evidence: Evidence[];
  reasoning: string;
  /** Required so the default missingInformation list (see
   *  detectMissingInfo()) can check this organization's REAL connector
   *  state rather than always claiming nothing is connected. Callers that
   *  already pass an explicit missingInformation never need it, but it's
   *  still required so a caller can't silently fall into the stale-default
   *  path by omission. */
  organizationId: string;
  missingInformation?: string[];
  alternativeExplanations?: string[];
  dataWindowHours?: number;
}): Promise<TrustEnvelope<T>> {
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
    missingInformation:
      params.missingInformation ??
      (await detectMissingInfo(params.organizationId)),
    alternativeExplanations: params.alternativeExplanations ?? [],
    dataFreshness: freshness,
  };
}

/**
 * Detect common missing information sources, checking this organization's
 * real connector state rather than assuming nothing is connected.
 *
 * Google Calendar and Email (Gmail) share a single Google OAuth
 * connection in this codebase (see countGoogleConnections()) - there is no
 * way to tell the two scopes apart from a connection count alone, so both
 * entries are cleared together once any member has connected Google.
 * There is no task-management integration anywhere in this codebase at
 * all (grep confirms it), so that entry is always genuinely true, not a
 * stale placeholder.
 */
async function detectMissingInfo(organizationId: string): Promise<string[]> {
  const missing: string[] = [];

  const hasGoogleConnection =
    (await countGoogleConnections(organizationId)) > 0;
  if (!hasGoogleConnection) {
    missing.push("Calendar integration not connected");
    missing.push("Email integration not connected");
  }
  missing.push("Task management system not connected");

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
