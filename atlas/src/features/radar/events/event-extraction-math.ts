/**
 * Pure extracted-event validation, split out of event-extractor.ts so it's
 * testable without that file's server-only AI/DB dependencies. Mirrors
 * memory-extraction-math.ts's shape.
 */

import { toExternalEventType } from "@/lib/enum-validators";
import type { ExternalEventType } from "@/lib/enum-validators";

const MIN_TITLE_LENGTH = 5;

export interface ExtractedEventCandidate {
  type: ExternalEventType;
  title: string;
  description: string;
  confidence: number;
  signalIndexes: number[];
  occurredAt: string;
}

/**
 * Filters raw AI-extracted event items down to ones with a recognized
 * type, non-trivial title, a valid confidence in [0,1], and at least one
 * signal index actually present in the batch that was sent to the model -
 * an event citing a signal index outside the batch (a model hallucination)
 * is rejected rather than persisted with broken evidence.
 */
export function selectValidEvents(
  extracted: unknown,
  signalCount: number
): ExtractedEventCandidate[] {
  if (!Array.isArray(extracted)) return [];

  const candidates: ExtractedEventCandidate[] = [];
  for (const item of extracted as Array<{
    type?: unknown;
    title?: unknown;
    description?: unknown;
    confidence?: unknown;
    signalIndexes?: unknown;
    occurredAt?: unknown;
  }>) {
    const eventType =
      typeof item?.type === "string" ? toExternalEventType(item.type) : null;

    if (
      eventType === null ||
      typeof item?.title !== "string" ||
      item.title.length < MIN_TITLE_LENGTH ||
      typeof item?.confidence !== "number" ||
      item.confidence < 0 ||
      item.confidence > 1 ||
      !Array.isArray(item.signalIndexes) ||
      item.signalIndexes.length === 0
    ) {
      continue;
    }

    const signalIndexes = item.signalIndexes.filter(
      (index): index is number =>
        typeof index === "number" &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < signalCount
    );
    if (signalIndexes.length === 0) continue;

    const occurredAt =
      typeof item.occurredAt === "string" &&
      !Number.isNaN(Date.parse(item.occurredAt))
        ? item.occurredAt
        : new Date().toISOString();

    candidates.push({
      type: eventType,
      title: item.title,
      description: typeof item.description === "string" ? item.description : "",
      confidence: item.confidence,
      signalIndexes,
      occurredAt,
    });
  }

  return candidates;
}
