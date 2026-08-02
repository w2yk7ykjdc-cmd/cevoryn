import * as Sentry from "@sentry/nextjs";

import { validateClientEnv, validateServerEnv } from "@/lib/env";

/**
 * Next.js instrumentation hook — runs once when the Node.js server starts.
 * Invalid configuration must fail fast instead of surfacing as unrelated
 * database, authentication, or AI errors during a user request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    validateServerEnv();
    validateClientEnv();

    console.info("[cevoryn] Environment validation passed");

    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      tracesSampleRate: 0.1,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      tracesSampleRate: 0.1,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
