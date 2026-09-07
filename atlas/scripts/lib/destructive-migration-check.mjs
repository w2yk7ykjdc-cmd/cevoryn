// Shared destructive-SQL detection used by both:
//   - scripts/deploy-migrate.mjs (production deploy gate: scans every
//     migration not yet recorded as applied in the target database)
//   - scripts/check-destructive-migrations.mjs (CI/PR gate: scans every
//     migration.sql newly added on this branch vs. its base)
//
// Added after the incident where an auto-generated migration silently
// dropped the live `google_connections` table because it had no Prisma
// `model` - see the GoogleConnection model's comment in schema.prisma.
// Kept in one place so the pattern list can't drift between the two
// gates that both need to agree on what counts as destructive.

export const DESTRUCTIVE_PATTERNS = [
  { name: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/i },
  { name: "DROP COLUMN", pattern: /\bDROP\s+COLUMN\b/i },
  { name: "DROP DATABASE", pattern: /\bDROP\s+DATABASE\b/i },
  { name: "DROP SCHEMA", pattern: /\bDROP\s+SCHEMA\b/i },
  { name: "TRUNCATE", pattern: /\bTRUNCATE\b/i },
];

export const ALLOW_DESTRUCTIVE_MARKER = "cevoryn:allow-destructive";

export function stripSqlComments(sql) {
  return sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Returns the list of matched destructive-statement names in `rawSql`, or
 * an empty array if none (either because there are none, or because the
 * file contains the explicit override marker). The marker is checked
 * against the raw text (it IS a comment) before comments are stripped for
 * the actual statement scan.
 */
export function scanMigrationSql(rawSql) {
  if (rawSql.includes(ALLOW_DESTRUCTIVE_MARKER)) return [];
  const withoutComments = stripSqlComments(rawSql);
  return DESTRUCTIVE_PATTERNS.filter(({ pattern }) =>
    pattern.test(withoutComments)
  ).map((m) => m.name);
}
