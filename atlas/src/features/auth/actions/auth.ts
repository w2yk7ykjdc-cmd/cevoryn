"use server";

import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/constants";
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
  const safeMessages: Record<string, string> = {
    "Invalid login credentials": "Invalid email or password.",
    "Email not confirmed": "Please confirm your email before signing in.",
    "User already registered": "An account with this email already exists.",
    "Password should be at least 6 characters":
      "Password must be at least 8 characters.",
  };
  return safeMessages[message] ?? "Authentication failed. Please try again.";
}

function getAppUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/\/$/, "")}`;

  return "http://localhost:3000";
}

function getSafeRedirectPath(path: string | undefined, fallback: string): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return fallback;
  }

  return path;
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

export async function signupAction(input: SignupInput): Promise<ActionResult> {
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

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${getAppUrl()}${ROUTES.AUTH_CALLBACK}?next=${encodeURIComponent(ROUTES.ONBOARDING)}`,
    },
  });

  if (error) {
    return { success: false, error: sanitizeAuthError(error.message) };
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

  const supabase = await createClient();
  // Always return success to prevent email enumeration.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getAppUrl()}${ROUTES.AUTH_CALLBACK}?next=${encodeURIComponent(ROUTES.RESET_PASSWORD)}`,
  });

  return { success: true, data: undefined };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(ROUTES.LOGIN);
}
