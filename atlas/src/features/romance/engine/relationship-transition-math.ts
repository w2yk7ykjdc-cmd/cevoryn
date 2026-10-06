/**
 * Relationship state transitions - pure. See
 * docs/romance/02-STORY_ENGINE_BIBLE.md §4. Every change is computed as a
 * delta plus a traceable RelationshipChangeRecord (previous/new value,
 * cause) - never a raw overwrite, per the brief's "every change
 * traceable" requirement. Values are clamped to [0, 100].
 *
 * This module only computes *what should change*. Applying it atomically
 * under concurrent writers (so two simultaneous deltas don't lose an
 * update) is the orchestration layer's job - see
 * romance-story.service.ts, which applies these deltas via a single
 * atomic SQL UPDATE rather than read-modify-write.
 */

import type {
  RelationshipDimensionKey,
  RelationshipDimensions,
  RelationshipEventCause,
} from "./types";

const MIN_VALUE = 0;
const MAX_VALUE = 100;

/**
 * Declarative delta table per cause. Chosen from the Story Engine Bible's
 * 5 dimensions (trust/attraction/fear/loyalty/tension) - no other
 * dimension exists to assign a delta to.
 */
const RELATIONSHIP_DELTAS: Record<
  RelationshipEventCause,
  Partial<RelationshipDimensions>
> = {
  PROMISE_MADE: {},
  PROMISE_FULFILLED: { trust: 10, loyalty: 5 },
  PROMISE_BROKEN: { trust: -20, tension: 15 },
  BARGAIN_SEALED: { tension: 5 },
  BARGAIN_BROKEN: { trust: -30, loyalty: -15, tension: 20 },
  TRUE_NAME_REVEALED: { trust: 15, fear: 10 },
};

export function clamp(value: number): number {
  return Math.max(MIN_VALUE, Math.min(MAX_VALUE, value));
}

export function getRelationshipDelta(
  cause: RelationshipEventCause
): Partial<RelationshipDimensions> {
  return RELATIONSHIP_DELTAS[cause];
}

/**
 * Computes the clamped next state and a traceable change record for each
 * dimension actually affected by `cause`. Dimensions with no configured
 * delta for this cause are left untouched (no change record emitted).
 */
export function applyRelationshipEvent(
  current: RelationshipDimensions,
  cause: RelationshipEventCause
): {
  next: RelationshipDimensions;
  changes: Array<{
    dimension: RelationshipDimensionKey;
    previousValue: number;
    newValue: number;
    delta: number;
    cause: RelationshipEventCause;
  }>;
} {
  const delta = RELATIONSHIP_DELTAS[cause];
  const next: RelationshipDimensions = { ...current };
  const changes: Array<{
    dimension: RelationshipDimensionKey;
    previousValue: number;
    newValue: number;
    delta: number;
    cause: RelationshipEventCause;
  }> = [];

  for (const key of Object.keys(delta) as RelationshipDimensionKey[]) {
    const rawDelta = delta[key];
    if (rawDelta === undefined || rawDelta === 0) continue;

    const previousValue = current[key];
    const newValue = clamp(previousValue + rawDelta);
    next[key] = newValue;

    if (newValue !== previousValue) {
      changes.push({
        dimension: key,
        previousValue,
        newValue,
        delta: newValue - previousValue,
        cause,
      });
    }
  }

  return { next, changes };
}
