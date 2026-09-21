const MAX_QUERY_LENGTH = 180;

export function buildNewsSearchQuery(
  entityName: string,
  entityDomain: string | null
): string {
  const name = entityName.trim();
  if (!name) return "";

  const domain = entityDomain?.trim().replace(/^www\./i, "");
  const domainClause = domain ? ` OR "${domain}"` : "";
  return `"${name}"${domainClause}`.slice(0, MAX_QUERY_LENGTH);
}
