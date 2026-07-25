import { validateClientEnv, validateServerEnv } from "@/lib/env";

/**
 * Next.js instrumentation hook — runs once when the Node.js server starts.
 * Invalid configuration must fail fast instead of surfacing as unrelated
 * database, authentication, or AI errors during a user request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  validateServerEnv();
  validateClientEnv();

  console.info("[cevoryn] Environment validation passed");
}
