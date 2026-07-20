/**
 * Next.js instrumentation hook — runs once at server startup.
 * Validates environment variables before any request is served.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateClientEnv, validateServerEnv } = await import("@/lib/env");

    try {
      validateServerEnv();
      validateClientEnv();
    } catch (error) {
      console.error(
        "[atlas] Invalid environment configuration. Copy .env.example to .env.local and fill in the values."
      );

      if (process.env.NODE_ENV === "production") {
        throw error;
      }
    }
  }
}
