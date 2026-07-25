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
