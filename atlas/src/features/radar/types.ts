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
  /**
   * Where this evidence came from - "EXTERNAL" (a signal/event, the only
   * kind that existed before Step 6) or "PROPRIETARY" (the organization's
   * own declared knowledge, see src/features/enterprise/proprietary-data/).
   * Optional and defaults to EXTERNAL when absent so every evidence row
   * written before this field existed stays valid without a backfill -
   * readers must treat a missing `source` as EXTERNAL, never as unknown.
   * Always assigned by application code from data it fetched itself
   * (event-extractor.ts's cited signals, or opportunity-generator.ts's
   * fetched ProprietaryDataRecord rows) - the LLM never asserts this
   * field or invents evidence of its own.
   */
  source?: "EXTERNAL" | "PROPRIETARY";
}

export interface OpportunityScoreBreakdown {
  relevance: number;
  strategicFit: number;
  economicPotential: number;
  timing: number;
  confidence: number;
}
