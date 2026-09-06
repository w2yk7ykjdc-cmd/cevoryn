import assert from "node:assert/strict";
import test from "node:test";

import { createKeywordSearchProvider } from "../src/lib/search/search-provider";

test("createKeywordSearchProvider reports type KEYWORD and delegates to the wrapped query function", async () => {
  const calls: Array<{ organizationId: string; query: string; limit: number }> =
    [];
  const provider = createKeywordSearchProvider(
    async (organizationId: string, query: string, limit: number) => {
      calls.push({ organizationId, query, limit });
      return [{ id: "1", name: "Acme" }];
    }
  );

  assert.equal(provider.type, "KEYWORD");

  const results = await provider.search("org-1", "acme", 5);

  assert.deepEqual(results, [{ id: "1", name: "Acme" }]);
  assert.deepEqual(calls, [
    { organizationId: "org-1", query: "acme", limit: 5 },
  ]);
});

test("createKeywordSearchProvider propagates the wrapped function's rejection", async () => {
  const provider = createKeywordSearchProvider(async () => {
    throw new Error("query failed");
  });

  await assert.rejects(
    () => provider.search("org-1", "acme", 5),
    /query failed/
  );
});
