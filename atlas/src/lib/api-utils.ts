import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

/**
 * Wrap an API handler with consistent error handling.
 * Catches unhandled errors, logs them, returns safe error response.
 */
export function apiHandler(
  handler: (...args: unknown[]) => Promise<NextResponse | Response>
): (...args: unknown[]) => Promise<NextResponse | Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return internalErrorResponse("API", error);
    }
  };
}

export function unauthorizedResponse() {
  return NextResponse.json(
    { error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
    { status: 401 }
  );
}

export function forbiddenResponse(message = "No organization") {
  return NextResponse.json(
    { error: { code: "FORBIDDEN", message } },
    { status: 403 }
  );
}

export function badRequestResponse(message: string) {
  return NextResponse.json(
    { error: { code: "BAD_REQUEST", message } },
    { status: 400 }
  );
}

export function notFoundResponse(message = "Not found") {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message } },
    { status: 404 }
  );
}

export function tooManyRequestsResponse(
  message = "Too many requests. Please try again later.",
  retryAfterSeconds?: number
) {
  const headers = retryAfterSeconds
    ? { "Retry-After": String(retryAfterSeconds) }
    : undefined;

  return NextResponse.json(
    { error: { code: "TOO_MANY_REQUESTS", message } },
    { status: 429, headers }
  );
}

export function internalErrorResponse(
  operation: string,
  error: unknown,
  message = "An unexpected error occurred"
) {
  const detail = error instanceof Error ? error.message : "Unknown error";
  console.error(`${operation} error:`, detail);
  Sentry.captureException(error, { tags: { scope: operation } });

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message:
          process.env.NODE_ENV === "development"
            ? `${message}: ${detail}`
            : message,
      },
    },
    { status: 500 }
  );
}
