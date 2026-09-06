/**
 * Versioned public API foundation (Phase 2, section 16): entities, signals,
 * events, opportunities, actions, and outcomes accessible from outside
 * CEVORYN.
 *
 * Status: response-shape contracts only. No `/api/v1/*` routes exist yet -
 * every current `/api/radar/*` route is an internal, session-cookie-
 * authenticated endpoint for CEVORYN's own UI, not a public/versioned API
 * (no API-key auth, no stability guarantee, no rate-limit tier). Building
 * public routes now, before there's a real external consumer or an API-key
 * auth layer, would be exactly the kind of premature surface the spec
 * warns against. What matters architecturally is that the *shape* exposed
 * publicly is decided deliberately (a stable v1 contract, versioned so it
 * can evolve later) rather than accidentally becoming "whatever the
 * internal Prisma model looks like this week" - so these types are
 * intentionally a subset/reshaping of the Radar Prisma models, not a
 * re-export of them.
 */

export const PUBLIC_API_VERSION = "v1" as const;

export interface PublicApiEntity {
  id: string;
  name: string;
  domain: string | null;
  watchReason: string;
  createdAt: string;
}

export interface PublicApiSignal {
  id: string;
  entityId: string;
  sourceType: string;
  title: string;
  observedAt: string;
}

export interface PublicApiEvent {
  id: string;
  entityId: string;
  type: string;
  title: string;
  occurredAt: string;
}

export interface PublicApiOpportunity {
  id: string;
  entityId: string;
  polarity: "OPPORTUNITY" | "THREAT";
  title: string;
  estimatedValueMin: number | null;
  estimatedValueMax: number | null;
  currency: string;
  confidence: number;
  status: string;
}

export interface PublicApiAction {
  id: string;
  opportunityId: string | null;
  status: string;
  executedAt: string | null;
}

export interface PublicApiOutcome {
  id: string;
  opportunityId: string | null;
  result: string;
}

/**
 * What a real v1 route handler would need, beyond the existing internal
 * session-auth pattern (getUser/getMembership) - a distinct API-key
 * identity that still resolves to one organizationId, so every public
 * route can reuse the same organizationId-scoped service functions the
 * internal routes already call.
 */
export interface PublicApiKeyContext {
  apiKeyId: string;
  organizationId: string;
  scopes: string[];
}
