"use server";

import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/types";

import { resetPasswordSchema } from "../schemas/auth";
import type { ResetPasswordInput } from "../schemas/auth";

export async function resetPasswordAction(
  input: ResetPasswordInput
): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(input);

  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false,
      error: "This reset link is invalid or has expired. Request a new link.",
    };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    console.error("Password reset error:", error.message);
    return {
      success: false,
      error: "Your password could not be updated. Request a new reset link and try again.",
    };
  }

  await supabase.auth.signOut();
  redirect(`${ROUTES.LOGIN}?reset=success`);
}
