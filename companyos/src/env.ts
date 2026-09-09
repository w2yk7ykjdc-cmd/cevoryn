import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Centralized, validated environment access. Import `env` instead of reading
 * `process.env` directly anywhere in the codebase — this is the only file
 * allowed to touch `process.env` for application configuration. Validation
 * runs eagerly at module load, so a missing/malformed variable crashes the
 * process at boot instead of failing deep inside a request handler.
 */
export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_URL: z.url().default("http://localhost:3000"),

    DATABASE_URL: z.url(),
    DIRECT_URL: z.url(),

    REDIS_URL: z.url(),

    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    BETTER_AUTH_URL: z.url().default("http://localhost:3000"),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),

    EMAIL_FROM: z.string().default("CompanyOS <noreply@example.com>"),
    RESEND_API_KEY: z.string().optional(),

    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),

    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRICE_ID_PRO: z.string().optional(),
    STRIPE_PRICE_ID_ENTERPRISE: z.string().optional(),

    AI_DEFAULT_PROVIDER: z
      .enum(["openai", "anthropic", "google"])
      .default("anthropic"),
    AI_DEFAULT_MODEL: z.string().default("claude-sonnet-5"),

    RATE_LIMIT_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(120),

    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    JOB_QUEUE_PREFIX: z.string().default("companyos"),

    /**
     * Sprint 19: a system-wide (not per-organization) fail-safe, distinct
     * from `AutonomyPolicy.killSwitchEngaged` (which is per-organization,
     * per-domain). When true, the paper-trading engine opens NO new
     * position for ANY organization -- open positions still update/close
     * normally. Defaults to false (not engaged); an operator sets it in
     * the deployment environment, never through the app itself, since
     * there is deliberately no UI/API path that could flip a system-wide
     * switch on behalf of one organization.
     */
    MARKET_EXECUTION_KILL_SWITCH: z.coerce.boolean().default(false),

    /**
     * Sprint 22: Binance PRIVATE (authenticated, signed) API credentials --
     * completely separate from the public market-data client
     * (`market-data/binance-client.ts`, which needs and uses neither of
     * these). Optional: an organization/deployment with neither set simply
     * has no live execution capability at all -- `execution/credentials.ts
     * #hasLiveCredentials()` is the single source of truth other code
     * checks, never a re-derived presence check. Read ONLY here, at process
     * boot, from the deployment environment -- NEVER written to the
     * database, NEVER accepted from a request body, NEVER exposed to the
     * frontend or an AI tool. See `execution/credentials.ts` for the
     * redaction discipline applied everywhere these are logged or reported.
     */
    BINANCE_API_KEY: z.string().optional(),
    BINANCE_API_SECRET: z.string().optional(),

    /**
     * Sprint 22 Phase 13: the LIVE mode master switch -- defaults to
     * `false` and MUST stay `false` in every environment this sprint ships
     * to. Distinct from `MARKET_EXECUTION_KILL_SWITCH` (an emergency STOP
     * for an already-enabled live execution path): this is the "was live
     * execution ever turned on for this deployment at all" gate, checked
     * first, before credentials, before the kill switch, before anything
     * else -- `execution/live-mode-gate.ts` refuses to report LIVE mode
     * ready while this is `false`, regardless of every other check's
     * result. There is deliberately no UI/API path in this codebase that
     * can flip this -- only a deployment operator, in the environment,
     * outside the running application, exactly like
     * `MARKET_EXECUTION_KILL_SWITCH`'s own precedent.
     */
    LIVE_EXECUTION_ENABLED: z.coerce.boolean().default(false),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  },
  experimental__runtimeEnv: {
    ...process.env,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});

/** Fails fast if no AI provider is configured but AI features are reachable. */
export function assertAiProviderConfigured(): void {
  const hasProvider =
    Boolean(env.OPENAI_API_KEY) ||
    Boolean(env.ANTHROPIC_API_KEY) ||
    Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY);

  if (!hasProvider) {
    throw new Error(
      "No AI provider configured. Set at least one of OPENAI_API_KEY, " +
        "ANTHROPIC_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY.",
    );
  }
}
