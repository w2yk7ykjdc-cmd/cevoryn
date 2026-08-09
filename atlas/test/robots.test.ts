/**
 * Coverage for the /robots.txt metadata route: production must allow
 * crawling, every other environment (preview, local dev, unset) must stay
 * disallowed so staging deployments never get indexed.
 */
import assert from "node:assert/strict";
import test from "node:test";

import robots from "../src/app/robots";

function withVercelEnv<T>(value: string | undefined, fn: () => T): T {
  const original = process.env.VERCEL_ENV;
  if (value === undefined) {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = value;
  }
  try {
    return fn();
  } finally {
    if (original === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = original;
    }
  }
}

test("production allows crawling", () => {
  const result = withVercelEnv("production", () => robots());
  assert.deepEqual(result, { rules: { userAgent: "*", allow: "/" } });
});

test("preview deployments stay disallowed", () => {
  const result = withVercelEnv("preview", () => robots());
  assert.deepEqual(result, { rules: { userAgent: "*", disallow: "/" } });
});

test("local development (no VERCEL_ENV) stays disallowed", () => {
  const result = withVercelEnv(undefined, () => robots());
  assert.deepEqual(result, { rules: { userAgent: "*", disallow: "/" } });
});
