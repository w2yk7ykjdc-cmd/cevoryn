// =============================================================================
// CEVORYN — Route & App Constants
// =============================================================================

export const ROUTES = {
  HOME: "/",
  LOGIN: "/login",
  SIGNUP: "/signup",
  FORGOT_PASSWORD: "/forgot-password",
  RESET_PASSWORD: "/reset-password",
  AUTH_CALLBACK: "/auth/callback",
  DASHBOARD: "/dashboard",
  ONBOARDING: "/onboarding",
  CHAT: "/chat",
  BRIEF: "/brief",
  SETTINGS: "/settings",
} as const;

export const PUBLIC_ROUTES: readonly string[] = [
  ROUTES.HOME,
  ROUTES.LOGIN,
  ROUTES.SIGNUP,
  ROUTES.FORGOT_PASSWORD,
  ROUTES.RESET_PASSWORD,
  ROUTES.AUTH_CALLBACK,
];

export const AUTH_ROUTES: readonly string[] = [
  ROUTES.LOGIN,
  ROUTES.SIGNUP,
  ROUTES.FORGOT_PASSWORD,
];

export const APP_CONFIG = {
  orgSlugMaxLength: 48,
  orgNameMaxLength: 100,
  displayNameMaxLength: 100,
  inviteExpirationDays: 7,
  maxMembersPerOrg: 20,
} as const;

// =============================================================================
// AI Constants
// =============================================================================

export const AI_CONFIG = {
  defaultModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  maxOutputTokens: Number(process.env.OPENAI_MAX_TOKENS ?? "2048"),
  temperature: 0.7,
  maxConversationHistory: 50,
  maxMessageLength: 10_000,
  titleGenerationModel: "gpt-4o-mini",
  titleMaxTokens: 30,
  dailyTokenLimitPerOrg: Number(
    process.env.DAILY_TOKEN_LIMIT_PER_ORG ?? "500000"
  ),
  /** Extension points for future modules */
  enabledModules: [] as readonly string[],
} as const;

export const CONVERSATION_CONFIG = {
  maxTitleLength: 100,
  listPageSize: 30,
} as const;
