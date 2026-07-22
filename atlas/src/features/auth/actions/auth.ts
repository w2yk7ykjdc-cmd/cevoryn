"use server";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
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

// =============================================================================
// Helpers
// =============================================================================

/** Sanitize Supabase error messages to avoid leaking internals */
function sanitizeAuthError(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "Invalid email or password.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Please confirm your email before signing in.";
  }
  if (
    normalized.includes("already registered") ||
    normalized.includes("already exists")
  ) {
    return "An account with this email already exists.";
  }
  if (normalized.includes("password") && normalized.includes("character")) {
    return "Password must meet the security requirements.";
  }
  if (normalized.includes("rate limit") || normalized.includes("too many")) {
    return "Too many authentication requests. Please wait and try again.";
  }
  if (normalized.includes("signup") && normalized.includes("disabled")) {
    return "New account registration is currently disabled.";
  }

  return "Authentication failed. Please try again.";
}

async function getAppUrl(): Promise<string> {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");

  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionUrl) return `https://${productionUrl.replace(/\/$/, "")}`;

  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  if (host?.includes("localhost")) {
    return `http://${host}`.replace(/\/$/, "");
  }

  return "https://atlas-kemal.vercel.app";
}

function getSafeRedirectPath(path: string | undefined, fallback: string): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return fallback;
  }

  return path;
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
  nextPath: string
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
    return {
      success: false,
      error: "This invite is invalid, expired, or belongs to another email.",
    };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Invite activation configuration is missing.");
    return {
      success: false,
      error: "Invite activation is not configured. Please contact the workspace owner.",
    };
  }

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

    if (!userAlreadyExists) {
      console.error("Invite user activation error:", createError.message);
      return { success: false, error: sanitizeAuthError(createError.message) };
    }

    // A previous signup attempt may have created an unconfirmed user before
    // email delivery failed. Repair that user by confirming the email and
    // applying the password entered on the invite screen.
    const { data: usersPage, error: listError } =
      await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });

    if (listError) {
      console.error("Invite user lookup error:", listError.message);
      return { success: false, error: sanitizeAuthError(listError.message) };
    }

    const existingUser = usersPage.users.find(
      (user) => user.email?.toLowerCase() === input.email.toLowerCase()
    );

    if (!existingUser) {
      return {
        success: false,
        error: "The invited account could not be prepared. Please try again.",
      };
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(
      existingUser.id,
      {
        password: input.password,
        email_confirm: true,
      }
    );

    if (updateError) {
      console.error("Invite user repair error:", updateError.message);
      return { success: false, error: sanitizeAuthError(updateError.message) };
    }
  } else if (!created.user) {
    return {
      success: false,
      error: "The invited account could not be created. Please try again.",
    };
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (signInError) {
    console.error("Invite user sign-in error:", signInError.message);
    return { success: false, error: sanitizeAuthError(signInError.message) };
  }

  redirect(nextPath);
}

// =============================================================================
// Actions
// =============================================================================

export async function loginAction(
  input: LoginInput,
  redirectTo?: string
): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { success: false, error: sanitizeAuthError(error.message) };
  }

  redirect(getSafeRedirectPath(redirectTo, ROUTES.DASHBOARD));
}

export async function signupAction(
  input: SignupInput,
  redirectTo?: string
): Promise<ActionResult> {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const nextPath = getConfirmationRedirectPath(redirectTo);

  const inviteResult = await activateInvitedUser(parsed.data, nextPath);
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
    console.error("Signup error:", error.message);
    return { success: false, error: sanitizeAuthError(error.message) };
  }

  if (data.session) {
    redirect(nextPath);
  }

  return { success: true, data: undefined };
}

export async function resendConfirmationAction(
  input: ForgotPasswordInput,
  redirectTo?: string
): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Enter a valid email address.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const nextPath = getConfirmationRedirectPath(redirectTo);
  const appUrl = await getAppUrl();
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${appUrl}${ROUTES.AUTH_CALLBACK}?next=${encodeURIComponent(nextPath)}`,
    },
  });

  if (error) {
    console.error("Confirmation resend error:", error.message);
    return {
      success: false,
      error: sanitizeAuthError(error.message),
    };
  }

  return { success: true, data: undefined };
}

export async function forgotPasswordAction(
  input: ForgotPasswordInput
): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const appUrl = await getAppUrl();
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${appUrl}${ROUTES.AUTH_CALLBACK}?next=${encodeURIComponent(ROUTES.RESET_PASSWORD)}`,
  });

  return { success: true, data: undefined };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(ROUTES.LOGIN);
}
