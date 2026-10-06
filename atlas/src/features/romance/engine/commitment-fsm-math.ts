/**
 * Status FSMs for Bargain / Promise / Debt - pure. Mirrors the exact
 * technique proven this session in
 * src/features/brain/decisions/decision.service.ts (VALID_SOURCE_STATUSES
 * map + optimistic-concurrency updateMany), per
 * docs/romance/00-REPOSITORY_AUDIT.md §5's instruction to reuse it
 * directly rather than re-deriving a new FSM technique.
 *
 * Fae Rules enforced here (docs/romance/02-STORY_ENGINE_BIBLE.md §3):
 * FAE-002 (a spoken bargain is binding - PROPOSED must be SEALED before
 * it can resolve) and FAE-005 (a broken bargain has consequences - BROKEN
 * is reachable only from SEALED, never skipped-to).
 */

export type BargainStatusLite = "PROPOSED" | "SEALED" | "FULFILLED" | "BROKEN";
export type PromiseStatusLite = "MADE" | "FULFILLED" | "BROKEN" | "FORGIVEN";
export type DebtStatusLite = "OPEN" | "REPAID" | "FORGIVEN" | "ESCALATED";

export const BARGAIN_VALID_SOURCE_STATUSES: Record<
  BargainStatusLite,
  BargainStatusLite[]
> = {
  PROPOSED: [],
  SEALED: ["PROPOSED"],
  FULFILLED: ["SEALED"],
  BROKEN: ["SEALED"],
};

export const PROMISE_VALID_SOURCE_STATUSES: Record<
  PromiseStatusLite,
  PromiseStatusLite[]
> = {
  MADE: [],
  FULFILLED: ["MADE"],
  BROKEN: ["MADE"],
  FORGIVEN: ["MADE", "BROKEN"],
};

export const DEBT_VALID_SOURCE_STATUSES: Record<
  DebtStatusLite,
  DebtStatusLite[]
> = {
  OPEN: [],
  REPAID: ["OPEN", "ESCALATED"],
  FORGIVEN: ["OPEN", "ESCALATED"],
  ESCALATED: ["OPEN"],
};

export function canTransitionBargain(
  from: BargainStatusLite,
  to: BargainStatusLite
): boolean {
  return BARGAIN_VALID_SOURCE_STATUSES[to].includes(from);
}

export function canTransitionPromise(
  from: PromiseStatusLite,
  to: PromiseStatusLite
): boolean {
  return PROMISE_VALID_SOURCE_STATUSES[to].includes(from);
}

export function canTransitionDebt(
  from: DebtStatusLite,
  to: DebtStatusLite
): boolean {
  return DEBT_VALID_SOURCE_STATUSES[to].includes(from);
}
