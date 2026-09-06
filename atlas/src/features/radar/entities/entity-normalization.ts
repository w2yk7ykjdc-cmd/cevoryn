/**
 * Pure, I/O-free entity-name normalization, split out of entity.service.ts
 * (which imports "server-only") so this stays importable from plain Node
 * test files - mirrors billing-errors.ts's/decision-scorer.ts's pattern.
 */

/**
 * Lowercased, whitespace-collapsed, punctuation-stripped name used only for
 * the org-scoped uniqueness check (`ExternalEntity_organizationId_normalizedName_key`)
 * so "Company X", "Company X Inc.", and "Company X, Inc" don't create three
 * rows in the same organization's watchlist. This is NOT cross-org entity
 * resolution - two different organizations watching the same real company
 * still get two independent rows, which is the deliberate MVP scope (see
 * ExternalEntity's schema comment).
 */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(inc|llc|ltd|gmbh|corp|co)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
