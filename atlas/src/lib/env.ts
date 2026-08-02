import { z } from "zod";

const serverSchema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().startsWith("sk-"),
  OPENAI_MODEL: z.string().min(1).default("gpt-4o-mini"),
  OPENAI_MAX_TOKENS: z.coerce.number().int().positive().default(2048),
  DAILY_TOKEN_LIMIT_PER_ORG: z.coerce.number().int().positive().default(500000),
  RESEND_API_KEY: z.string().startsWith("re_").optional(),
  EMAIL_FROM: z.string().min(3).optional(),
  PADDLE_API_KEY: z.string().min(1).optional(),
  PADDLE_WEBHOOK_SECRET: z.string().min(1).optional(),
  PADDLE_ENV: z.enum(["sandbox", "production"]).optional(),
  PADDLE_PRICE_STARTER: z.string().min(1).optional(),
  PADDLE_PRICE_PROFESSIONAL: z.string().min(1).optional(),
  PADDLE_PRICE_BUSINESS: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_TOKEN_ENCRYPTION_KEY: z.string().min(32).optional(),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_APP_NAME: z.string().default("CEVORYN"),
  NEXT_PUBLIC_ENABLE_AI: z
    .string()
    .transform((value) => value === "true")
    .default("true"),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: z
    .string()
    .regex(/^(test|live)_/, "must start with test_ or live_")
    .optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type ClientEnv = z.infer<typeof clientSchema>;

/** Validate all server-only environment variables. */
export function validateServerEnv(): ServerEnv {
  const parsed = serverSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error(
      "Invalid server environment variables:",
      parsed.error.flatten().fieldErrors
    );
    throw new Error("Invalid server environment variables");
  }

  if (Boolean(parsed.data.RESEND_API_KEY) !== Boolean(parsed.data.EMAIL_FROM)) {
    throw new Error(
      "RESEND_API_KEY and EMAIL_FROM must either both be configured or both be omitted"
    );
  }

  const paddleVars = {
    PADDLE_API_KEY: parsed.data.PADDLE_API_KEY,
    PADDLE_WEBHOOK_SECRET: parsed.data.PADDLE_WEBHOOK_SECRET,
    PADDLE_PRICE_STARTER: parsed.data.PADDLE_PRICE_STARTER,
    PADDLE_PRICE_PROFESSIONAL: parsed.data.PADDLE_PRICE_PROFESSIONAL,
    PADDLE_PRICE_BUSINESS: parsed.data.PADDLE_PRICE_BUSINESS,
    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN:
      process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.trim(),
  };
  const paddleConfigured = Object.values(paddleVars).some(Boolean);
  const paddleMissing = Object.entries(paddleVars)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (paddleConfigured && paddleMissing.length > 0) {
    throw new Error(
      `Paddle billing is partially configured; missing: ${paddleMissing.join(", ")}`
    );
  }

  if (paddleConfigured) {
    const expectedPrefix =
      parsed.data.PADDLE_ENV === "sandbox" ? "test_" : "live_";
    if (
      !paddleVars.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.startsWith(expectedPrefix)
    ) {
      throw new Error(
        `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN must start with "${expectedPrefix}" when PADDLE_ENV is ${parsed.data.PADDLE_ENV ?? "production"}`
      );
    }
  }

  const googleVars = {
    GOOGLE_CLIENT_ID: parsed.data.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: parsed.data.GOOGLE_CLIENT_SECRET,
    GOOGLE_TOKEN_ENCRYPTION_KEY: parsed.data.GOOGLE_TOKEN_ENCRYPTION_KEY,
  };
  const googleConfigured = Object.values(googleVars).some(Boolean);
  const googleMissing = Object.entries(googleVars)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (googleConfigured && googleMissing.length > 0) {
    throw new Error(
      `Google integration is partially configured; missing: ${googleMissing.join(", ")}`
    );
  }

  return parsed.data;
}

/** Validate public environment variables without reading server secrets. */
export function validateClientEnv(): ClientEnv {
  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_ENABLE_AI: process.env.NEXT_PUBLIC_ENABLE_AI,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  });

  if (!parsed.success) {
    console.error(
      "Invalid client environment variables:",
      parsed.error.flatten().fieldErrors
    );
    throw new Error("Invalid client environment variables");
  }

  return parsed.data;
}
