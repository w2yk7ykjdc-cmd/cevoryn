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

test("boots with no Paddle or Google configuration", () => {
  withEnv(
    {
      PADDLE_API_KEY: undefined,
      PADDLE_WEBHOOK_SECRET: undefined,
      PADDLE_PRICE_STARTER: undefined,
      PADDLE_PRICE_PROFESSIONAL: undefined,
      PADDLE_PRICE_BUSINESS: undefined,
      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: undefined,
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      GOOGLE_TOKEN_ENCRYPTION_KEY: undefined,
    },
    () => assert.doesNotThrow(() => validateServerEnv())
  );
});

test("rejects a partially configured Paddle setup", () => {
  withEnv(
    {
      PADDLE_API_KEY: "pdl_live_key",
      PADDLE_WEBHOOK_SECRET: undefined,
      PADDLE_PRICE_STARTER: "pri_starter",
      PADDLE_PRICE_PROFESSIONAL: "pri_pro",
      PADDLE_PRICE_BUSINESS: "pri_business",
      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "live_token",
    },
    () =>
      assert.throws(
        () => validateServerEnv(),
        /Paddle billing is partially configured/
      )
  );
});

test("rejects a sandbox Paddle client token that doesn't match PADDLE_ENV", () => {
  withEnv(
    {
      PADDLE_API_KEY: "pdl_live_key",
      PADDLE_WEBHOOK_SECRET: "whsec_test",
      PADDLE_ENV: "sandbox",
      PADDLE_PRICE_STARTER: "pri_starter",
      PADDLE_PRICE_PROFESSIONAL: "pri_pro",
      PADDLE_PRICE_BUSINESS: "pri_business",
      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "live_token",
    },
    () =>
      assert.throws(
        () => validateServerEnv(),
        /NEXT_PUBLIC_PADDLE_CLIENT_TOKEN must start with "test_"/
      )
  );
});

test("accepts a fully configured production Paddle setup", () => {
  withEnv(
    {
      PADDLE_API_KEY: "pdl_live_key",
      PADDLE_WEBHOOK_SECRET: "whsec_test",
      PADDLE_ENV: "production",
      PADDLE_PRICE_STARTER: "pri_starter",
      PADDLE_PRICE_PROFESSIONAL: "pri_pro",
      PADDLE_PRICE_BUSINESS: "pri_business",
      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "live_token",
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
