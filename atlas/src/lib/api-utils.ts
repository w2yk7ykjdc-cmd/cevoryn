import { NextResponse } from "next/server";

/**
 * Wrap an API handler with consistent error handling.
 * Catches unhandled errors, logs them, returns safe error response.
 */
export function apiHandler<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<NextResponse | Response>
): (...args: TArgs) => Promise<NextResponse | Response> {
  return async (...args: TArgs) => {
    try {
      return await handler(...args);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Internal server error";
      console.error(`API error: ${message}`);

      return NextResponse.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message:
              process.env.NODE_ENV === "development"
                ? message
                : "An unexpected error occurred",
          },
        },
        { status: 500 }
      );
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
