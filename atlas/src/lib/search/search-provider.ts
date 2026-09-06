/**
 * Generic search abstraction. Today's only implementation wraps Postgres
 * ILIKE (see createKeywordSearchProvider) - existing callers keep their
 * exact current behavior, byte-for-byte. The seam exists so a future
 * SemanticSearchProvider (embeddings + vector similarity) can be swapped in
 * per call site without changing that call site's contract, without
 * standing up embedding infrastructure or incurring embedding cost today.
 */

export type SearchProviderType = "KEYWORD" | "SEMANTIC";

export interface SearchProvider<T> {
  readonly type: SearchProviderType;
  search(organizationId: string, query: string, limit: number): Promise<T[]>;
}

/**
 * Wraps an existing organization-scoped ILIKE query function as a
 * SearchProvider. `runIlikeSearch` is expected to already be exactly the
 * Prisma call a call site used before adopting this abstraction - this
 * does not change what is queried, only names the seam.
 */
export function createKeywordSearchProvider<T>(
  runIlikeSearch: (
    organizationId: string,
    query: string,
    limit: number
  ) => Promise<T[]>
): SearchProvider<T> {
  return {
    type: "KEYWORD",
    search: runIlikeSearch,
  };
}
