import assert from "node:assert/strict";
import test from "node:test";

import { validateServerEnv } from "../src/lib/env";

const REQUIRED_BASE_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  OPENAI_API_KEY: "sk-test",
};

function withEnv<T>(
  overrides: Record<string, string | undefined>,
  run: () => T
): T {
  const original: Record<string, string | undefined> = {};
  const keys = Object.keys({ ...REQUIRED_BASE_ENV, ...overrides });

  for (const key of keys) {
    original[key] = process.env[key];
    const value = { ...REQUIRED_BASE_ENV, ...overrides }[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return run();
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

test("boots with no Polar or Google configuration", () => {
  withEnv(
    {
      POLAR_ACCESS_TOKEN: undefined,
      POLAR_WEBHOOK_SECRET: undefined,
      POLAR_PRODUCT_STARTER: undefined,
      POLAR_PRODUCT_PROFESSIONAL: undefined,
      POLAR_PRODUCT_BUSINESS: undefined,
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      GOOGLE_TOKEN_ENCRYPTION_KEY: undefined,
    },
    () => assert.doesNotThrow(() => validateServerEnv())
  );
});

test("rejects a partially configured Polar setup", () => {
  withEnv(
    {
      POLAR_ACCESS_TOKEN: "polar_oat_live_key",
      POLAR_WEBHOOK_SECRET: undefined,
      POLAR_PRODUCT_STARTER: "prod_starter",
      POLAR_PRODUCT_PROFESSIONAL: "prod_pro",
      POLAR_PRODUCT_BUSINESS: "prod_business",
    },
    () =>
      assert.throws(
        () => validateServerEnv(),
        /Polar billing is partially configured/
      )
  );
});

test("accepts a fully configured production Polar setup", () => {
  withEnv(
    {
      POLAR_ACCESS_TOKEN: "polar_oat_live_key",
      POLAR_WEBHOOK_SECRET: "whsec_test",
      POLAR_ENV: "production",
      POLAR_PRODUCT_STARTER: "prod_starter",
      POLAR_PRODUCT_PROFESSIONAL: "prod_pro",
      POLAR_PRODUCT_BUSINESS: "prod_business",
    },
    () => assert.doesNotThrow(() => validateServerEnv())
  );
});

test("rejects a partially configured Google integration", () => {
  withEnv(
    {
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: undefined,
      GOOGLE_TOKEN_ENCRYPTION_KEY: "a".repeat(32),
    },
    () =>
      assert.throws(
        () => validateServerEnv(),
        /Google integration is partially configured/
      )
  );
});

test("rejects a Google encryption key shorter than 32 characters", () => {
  withEnv(
    {
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_TOKEN_ENCRYPTION_KEY: "too-short",
    },
    () => assert.throws(() => validateServerEnv())
  );
});

test("accepts a fully configured Google integration", () => {
  withEnv(
    {
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_TOKEN_ENCRYPTION_KEY: "a".repeat(32),
    },
    () => assert.doesNotThrow(() => validateServerEnv())
  );
});
