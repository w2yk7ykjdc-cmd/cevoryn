/**
 * Next.js instrumentation hook — runs once at server startup.
 * Validates environment variables before any request is served.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const required = [
      "DATABASE_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "OPENAI_API_KEY",
    ];

    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      console.error(
        `[atlas] Missing required environment variables: ${missing.join(", ")}`
      );
      console.error(
        "[atlas] Copy .env.example to .env.local and fill in the values."
      );
      // Don't throw — allow build to complete. Runtime will fail gracefully.
    }
  }
}
