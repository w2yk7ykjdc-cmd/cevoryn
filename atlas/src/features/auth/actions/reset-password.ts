"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ROUTES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/types";

import { resetPasswordSchema } from "../schemas/auth";
import type { ResetPasswordInput } from "../schemas/auth";

export async function resetPasswordAction(
  input: ResetPasswordInput
): Promise<ActionResult> {
  const t = await getTranslations("auth.errors");
  const parsed = resetPasswordSchema.safeParse(input);

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false,
      error: t("resetLinkInvalid"),
    };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    console.error("Password reset error:", error.message);
    return {
      success: false,
      error: t("resetPasswordFailed"),
    };
  }

  await supabase.auth.signOut();
  redirect(`${ROUTES.LOGIN}?reset=success`);
}
