/**
 * Shared types for the Radar feature (external company/opportunity
 * intelligence). Kept separate from Prisma's generated types where the API
 * response shape differs from the DB row (e.g. Json fields narrowed to a
 * concrete evidence shape).
 */

export interface EvidenceItem {
  label: string;
  sourceUrl?: string;
  excerpt?: string;
}

export interface OpportunityScoreBreakdown {
  relevance: number;
  strategicFit: number;
  economicPotential: number;
  timing: number;
  confidence: number;
}
