import * as Sentry from "@sentry/nextjs";
import "server-only";

/**
 * Log + report a server-side error consistently. Sentry.captureException is a
 * no-op when NEXT_PUBLIC_SENTRY_DSN isn't configured (see instrumentation.ts),
 * so this is safe to call unconditionally.
 */
export function captureServerError(
  scope: string,
  error: unknown,
  context?: Record<string, unknown>
): void {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`[cevoryn:${scope}]`, message, context ?? {});

  Sentry.captureException(error, {
    tags: { scope },
    extra: context,
  });
}
