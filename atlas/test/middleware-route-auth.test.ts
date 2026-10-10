import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { middleware } from "../src/middleware";

for (const pathname of [
  "/api/romance/billing/checkout",
  "/api/romance/billing/portal",
]) {
  test(pathname + " reaches its route-level JSON auth handler", async () => {
    const request = new NextRequest("https://www.cevoryn.com" + pathname, {
      method: "POST",
    });

    const response = await middleware(request);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });
}

test("route-level Romance billing auth does not bypass cross-site mutation protection", async () => {
  const request = new NextRequest(
    "https://www.cevoryn.com/api/romance/billing/checkout",
    {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
    }
  );

  const response = await middleware(request);

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: {
      code: "INVALID_ORIGIN",
      message: "Cross-site API mutations are not allowed",
    },
  });
});
