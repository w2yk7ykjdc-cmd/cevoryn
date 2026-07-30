"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function isRedirectError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export async function login(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      redirect(`/login?error=${encodeURIComponent(error.message)}`);
    }
  } catch (e) {
    if (isRedirectError(e)) throw e;
    const message = e instanceof Error ? e.message : "Beklenmeyen bir hata olustu";
    redirect(`/login?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signup(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const passwordConfirm = formData.get("passwordConfirm") as string;

  if (password !== passwordConfirm) {
    redirect(`/login?error=${encodeURIComponent("Sifreler eslesmiyor")}`);
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm`,
      },
    });

    if (error) {
      console.error("[signup] Supabase signUp error:", error);
      redirect(`/login?error=${encodeURIComponent(error.message)}`);
    }
  } catch (e) {
    if (isRedirectError(e)) throw e;
    console.error("[signup] Unexpected exception:", e);
    const message = e instanceof Error ? e.message : "Beklenmeyen bir hata olustu";
    redirect(`/login?error=${encodeURIComponent(message)}`);
  }

  redirect("/login?message=Hesabini onaylamak icin e-postani kontrol et");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
