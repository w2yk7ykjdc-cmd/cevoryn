import { z } from "zod";

import { captureServerError } from "@/lib/error-reporting";

import type { Evidence } from "./types";

export const evidenceSchema = z.object({
  source: z.enum(["conversation", "memory", "pulse", "insight", "activity"]),
  sourceId: z.string(),
  excerpt: z.string(),
  timestamp: z.string(),
  weight: z.number(),
});

/**
 * Validates an Insight.evidence / DecisionCanvas.evidence Json column.
 * Returns [] on a mismatch so a malformed row renders with no evidence
 * instead of throwing or leaking an unvalidated shape into the UI/prompt.
 */
export function parseEvidence(value: unknown): Evidence[] {
  const result = z.array(evidenceSchema).safeParse(value);
  if (!result.success) {
    captureServerError(
      "brain.json-schemas.evidence",
      new Error("Evidence Json column failed schema validation"),
      { issues: result.error.issues }
    );
    return [];
  }
  return result.data;
}
