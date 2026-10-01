const MAX_QUERY_LENGTH = 180;

export function buildNewsSearchQuery(
  entityName: string,
  entityDomain: string | null
): string {
  const name = entityName.trim();
  if (!name) return "";

  const domain = entityDomain?.trim().replace(/^www\./i, "") || "";
  const domainClause = domain ? ` OR "${domain}"` : "";
  const availableForName = Math.max(
    1,
    MAX_QUERY_LENGTH - domainClause.length - 2
  );
  const safeName =
    name.length > availableForName
      ? name.slice(0, availableForName).trim()
      : name;

  return `"${safeName}"${domainClause}`.slice(0, MAX_QUERY_LENGTH);
}
