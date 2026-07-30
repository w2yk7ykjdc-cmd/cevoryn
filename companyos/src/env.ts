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

    AI_DEFAULT_PROVIDER: z
      .enum(["openai", "anthropic", "google"])
      .default("anthropic"),
    AI_DEFAULT_MODEL: z.string().default("claude-sonnet-5"),

    RATE_LIMIT_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(120),

    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    JOB_QUEUE_PREFIX: z.string().default("companyos"),
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
