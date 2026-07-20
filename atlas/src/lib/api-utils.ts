import { NextResponse } from "next/server";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

type ApiHandler<TArgs extends unknown[]> = (
  ...args: TArgs
) => Promise<NextResponse | Response>;

/**
 * Wrap an API handler with consistent error handling.
 * Catches unhandled errors, logs them, returns safe error response.
 */
export function apiHandler<TArgs extends unknown[]>(
  handler: ApiHandler<TArgs>
): ApiHandler<TArgs> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Internal server error";
      console.error("API error:", error);

      return errorResponse(
        "INTERNAL_ERROR",
        process.env.NODE_ENV === "development"
          ? message
          : "An unexpected error occurred",
        500
      );
    }
  };
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  details?: unknown
) {
  const body: ApiErrorBody = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return NextResponse.json(body, { status });
}

export function unauthorizedResponse(message = "Not authenticated") {
  return errorResponse("UNAUTHORIZED", message, 401);
}

export function forbiddenResponse(message = "No organization") {
  return errorResponse("FORBIDDEN", message, 403);
}

export function badRequestResponse(message: string, details?: unknown) {
  return errorResponse("BAD_REQUEST", message, 400, details);
}

export function validationErrorResponse(details?: unknown) {
  return errorResponse("VALIDATION_ERROR", "Invalid input", 400, details);
}

export function notFoundResponse(message = "Not found") {
  return errorResponse("NOT_FOUND", message, 404);
}

export function rateLimitedResponse(resetAt?: Date) {
  return NextResponse.json(
    { error: { code: "RATE_LIMITED", message: "Daily token limit reached" } },
    {
      status: 429,
      headers: resetAt ? { "Retry-After": resetAt.toISOString() } : undefined,
    }
  );
}
