"use server";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ROUTES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { getSafeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";
import {
  getClientIp,
  isAuthRateLimited,
  recordAuthAttempt,
  tryRecordAuthAttempt,
} from "@/server/services/auth-rate-limit.service";
import type { ActionResult } from "@/types";

import {
  forgotPasswordSchema,
  loginSchema,
  signupSchema,
} from "../schemas/auth";
import type {
  ForgotPasswordInput,
  LoginInput,
  SignupInput,
} from "../schemas/auth";

type AuthErrors = Awaited<ReturnType<typeof getTranslations>>;

function sanitizeAuthError(message: string, t: AuthErrors): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials"))
    return t("invalidCredentials");
  if (normalized.includes("email not confirmed")) return t("emailNotConfirmed");
  if (
    normalized.includes("already registered") ||
    normalized.includes("already exists")
  )
    return t("alreadyRegistered");
  if (normalized.includes("password") && normalized.includes("character"))
    return t("passwordRequirements");
  if (normalized.includes("rate limit") || normalized.includes("too many"))
    return t("rateLimited");
  if (normalized.includes("signup") && normalized.includes("disabled"))
    return t("signupDisabled");
  return t("generic");
}

async function getAppUrl(): Promise<string> {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionUrl) return `https://${productionUrl.replace(/\/$/, "")}`;
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  if (host?.includes("localhost")) return `http://${host}`.replace(/\/$/, "");
  return "https://cevoryn.com";
}

function getConfirmationRedirectPath(redirectTo?: string): string {
  return getSafeRedirectPath(redirectTo, ROUTES.ONBOARDING);
}

function getInviteToken(path: string): string | null {
  const match = path.match(/^\/invite\/([^/?#]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function activateInvitedUser(
  input: SignupInput,
  nextPath: string,
  t: AuthErrors
): Promise<ActionResult | null> {
  const token = getInviteToken(nextPath);
  if (!token) return null;
  const invite = await prisma.invite.findUnique({
    where: { token },
    select: { email: true, status: true, expiresAt: true },
  });
  if (
    !invite ||
    invite.status !== "PENDING" ||
    invite.expiresAt.getTime() <= Date.now() ||
    invite.email.toLowerCase() !== input.email.toLowerCase()
  ) {
    return { success: false, error: t("inviteInvalid") };
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey)
    return { success: false, error: t("inviteNotConfigured") };
  const admin = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
    });
  if (createError) {
    const normalized = createError.message.toLowerCase();
    const userAlreadyExists =
      normalized.includes("already") || normalized.includes("exists");
    if (!userAlreadyExists)
      return {
        success: false,
        error: sanitizeAuthError(createError.message, t),
      };
    const { data: usersPage, error: listError } =
      await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError)
      return { success: false, error: sanitizeAuthError(listError.message, t) };
    const existingUser = usersPage.users.find(
      (user) => user.email?.toLowerCase() === input.email.toLowerCase()
    );
    if (!existingUser)
      return { success: false, error: t("inviteAccountFailed") };
    if (existingUser.email_confirmed_at)
      return { success: false, error: t("inviteAlreadyExists") };
    const { error: updateError } = await admin.auth.admin.updateUserById(
      existingUser.id,
      { password: input.password, email_confirm: true }
    );
    if (updateError)
      return {
        success: false,
        error: sanitizeAuthError(updateError.message, t),
      };
  } else if (!created.user) {
    return { success: false, error: t("inviteCreateFailed") };
  }
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });
  if (signInError)
    return { success: false, error: sanitizeAuthError(signInError.message, t) };
  redirect(nextPath);
}

export async function googleLoginAction(formData: FormData): Promise<void> {
  const t = await getTranslations("auth.errors");
  const requestedRedirect = formData.get("redirectTo");
  const nextPath = getSafeRedirectPath(
    typeof requestedRedirect === "string" ? requestedRedirect : undefined,
    ROUTES.DASHBOARD
  );
  const appUrl = await getAppUrl();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${appUrl}${ROUTES.AUTH_CALLBACK}?next=${encodeURIComponent(nextPath)}`,
    },
  });
  if (error || !data.url) {
    const message = error
      ? sanitizeAuthError(error.message, t)
      : t("googleSignInFailed");
    redirect(`${ROUTES.LOGIN}?error=${encodeURIComponent(message)}`);
  }
  redirect(data.url);
}

export async function loginAction(
  input: LoginInput,
  redirectTo?: string
): Promise<ActionResult<string>> {
  const t = await getTranslations("auth.errors");
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: t("invalidInput"),
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }
  const email = parsed.data.email;
  const clientIp = await getClientIp();

  if (await isAuthRateLimited("login_email", email)) {
    return { success: false, error: t("rateLimited") };
  }
  if (clientIp && (await isAuthRateLimited("login_ip", clientIp))) {
    return { success: false, error: t("rateLimited") };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  });
  if (error) {
    await recordAuthAttempt("login_email", email);
    if (clientIp) await recordAuthAttempt("login_ip", clientIp);
    return { success: false, error: sanitizeAuthError(error.message, t) };
  }
  return {
    success: true,
    data: getSafeRedirectPath(redirectTo, ROUTES.DASHBOARD),
  };
}

export async function signupAction(
  input: SignupInput,
  redirectTo?: string
): Promise<ActionResult> {
  const t = await getTranslations("auth.errors");
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success)
    return {
      success: false,
      error: t("invalidInput"),
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  const clientIp = await getClientIp();
  if (clientIp && (await isAuthRateLimited("signup_ip", clientIp))) {
    return { success: false, error: t("rateLimited") };
  }
  if (clientIp) await recordAuthAttempt("signup_ip", clientIp);

  const nextPath = getConfirmationRedirectPath(redirectTo);
  const inviteResult = await activateInvitedUser(parsed.data, nextPath, t);
  if (inviteResult) return inviteResult;
  const appUrl = await getAppUrl();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${appUrl}${ROUTES.AUTH_CALLBACK}?next=${encodeURIComponent(nextPath)}`,
    },
  });
  if (error) {
    const normalized = error.message.toLowerCase();
    const alreadyRegistered =
      normalized.includes("already registered") ||
      normalized.includes("already exists");
    // Must never reveal whether this email already has an account - same
    // generic "check your email" response a fresh signup gets, mirroring
    // forgotPasswordAction's own anti-enumeration design below.
    if (alreadyRegistered) return { success: true, data: undefined };
    return { success: false, error: sanitizeAuthError(error.message, t) };
  }
  if (data.session) redirect(nextPath);
  return { success: true, data: undefined };
}

export async function resendConfirmationAction(
  input: ForgotPasswordInput,
  redirectTo?: string
): Promise<ActionResult> {
  const t = await getTranslations("auth.errors");
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success)
    return {
      success: false,
      error: t("invalidInput"),
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  const email = parsed.data.email;

  // Same anti-abuse posture as forgotPasswordAction: a rate-limited
  // request still returns success, never revealing whether this email is
  // registered or whether it's being throttled. Unlike before, an actual
  // Supabase error (e.g. already confirmed) is no longer surfaced either,
  // for the same reason. tryRecordAuthAttempt (atomic check-and-record)
  // rather than the two-step isAuthRateLimited+recordAuthAttempt pattern,
  // since every attempt here counts regardless of outcome - the same
  // check-then-act race those two calls would otherwise open.
  if (await tryRecordAuthAttempt("resend_confirmation_email", email)) {
    const nextPath = getConfirmationRedirectPath(redirectTo);
    const appUrl = await getAppUrl();
    const supabase = await createClient();
    await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: `${appUrl}${ROUTES.AUTH_CALLBACK}?next=${encodeURIComponent(nextPath)}`,
      },
    });
  }

  return { success: true, data: undefined };
}

export async function forgotPasswordAction(
  input: ForgotPasswordInput
): Promise<ActionResult> {
  const t = await getTranslations("auth.errors");
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success)
    return {
      success: false,
      error: t("invalidInput"),
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  const email = parsed.data.email;

  // Rate-limited requests still return { success: true } below, same as
  // every other outcome here — this must never reveal whether the email
  // is registered or whether it's being throttled.
  if (!(await isAuthRateLimited("forgot_password_email", email))) {
    await recordAuthAttempt("forgot_password_email", email);
    const appUrl = await getAppUrl();
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl}${ROUTES.AUTH_CALLBACK}?next=${encodeURIComponent(ROUTES.RESET_PASSWORD)}`,
    });
  }

  return { success: true, data: undefined };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(ROUTES.LOGIN);
}
