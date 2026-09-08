import type { OpportunityStatus } from "@prisma/client";

export type { OpportunityStatus };

export type ListOpportunitiesInput = {
  organizationId: string;
  status?: OpportunityStatus;
  limit?: number;
  cursor?: string;
};

export type ExpireStaleOpportunityInput = {
  organizationId: string;
  opportunityId: string;
  /** Attributed on the `opportunity.ai_expired` AuditLog entry when a transition actually happens. */
  actorId: string;
};

/**
 * Why an eligible-looking Opportunity was NOT expired — every branch besides
 * `already_transitioned` and `still_active` reflects the record simply not
 * being the kind of Opportunity Sprint 10's pilot rule understands (fails
 * closed rather than guessing); `still_active` means the deterministic
 * staleness re-check genuinely found the lead is still stalled and
 * high-value. None of these are errors — a `false` result is a normal,
 * expected, idempotent outcome (e.g. a retry after a concurrent caller
 * already made the transition).
 */
export type ExpireStaleOpportunityBlockedReason =
  | "not_found"
  | "unsupported_rule"
  | "not_eligible_status"
  | "missing_related_entity"
  | "still_active"
  | "already_transitioned";

export type ExpireStaleOpportunityResult =
  | { expired: true; opportunityId: string }
  | { expired: false; reason: ExpireStaleOpportunityBlockedReason; currentStatus?: OpportunityStatus };
