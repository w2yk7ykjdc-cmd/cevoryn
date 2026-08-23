import { z } from "zod";

import { captureServerError } from "@/lib/error-reporting";

import type { BriefSection, PulseMetrics } from "./types";

const pulseMetricsSchema = z.object({
  conversationCount: z.number(),
  messageCount: z.number(),
  activeUserCount: z.number(),
  topTopics: z.array(z.object({ topic: z.string(), count: z.number() })),
  avgResponseTimeMs: z.number(),
  tokenUsage: z.object({
    input: z.number(),
    output: z.number(),
    total: z.number(),
  }),
});

const briefSectionSchema = z.object({
  heading: z.string(),
  content: z.string(),
  priority: z.enum(["high", "medium", "low"]),
});

/**
 * Validates a PulseSnapshot.metrics Json column against its expected shape.
 * Returns null (instead of throwing) on a mismatch so a single corrupted or
 * stale row degrades to "no comparison data" rather than crashing the page -
 * the caller already treats a null previous snapshot as "first ever pulse".
 */
export function parsePulseMetrics(value: unknown): PulseMetrics | null {
  const result = pulseMetricsSchema.safeParse(value);
  if (!result.success) {
    captureServerError(
      "brain.json-schemas.pulseMetrics",
      new Error("PulseSnapshot.metrics failed schema validation"),
      { issues: result.error.issues }
    );
    return null;
  }
  return result.data;
}

/**
 * Validates a Brief.sections Json column. Returns [] on a mismatch so a
 * malformed brief renders with no sections instead of throwing.
 */
export function parseBriefSections(value: unknown): BriefSection[] {
  const result = z.array(briefSectionSchema).safeParse(value);
  if (!result.success) {
    captureServerError(
      "brain.json-schemas.briefSections",
      new Error("Brief.sections failed schema validation"),
      { issues: result.error.issues }
    );
    return [];
  }
  return result.data;
}
