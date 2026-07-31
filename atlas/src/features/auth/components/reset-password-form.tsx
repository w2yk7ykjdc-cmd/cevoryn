"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/lib/constants";

import { resetPasswordAction } from "../actions/reset-password";
import { createResetPasswordSchema } from "../schemas/auth";
import type { ResetPasswordInput } from "../schemas/auth";

import { AuthCard } from "./auth-card";

export function ResetPasswordForm() {
  const t = useTranslations("auth.resetPassword");
  const tValidation = useTranslations("auth.validation");
  const [isPending, setIsPending] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(
      createResetPasswordSchema({
        invalidEmail: tValidation("invalidEmail"),
        passwordMinLength: tValidation("passwordMinLength"),
        passwordComplexity: tValidation("passwordComplexity"),
        passwordsDoNotMatch: tValidation("passwordsDoNotMatch"),
      })
    ),
    defaultValues: { password: "", confirmPassword: "" },
  });

  async function onSubmit(data: ResetPasswordInput) {
    setIsPending(true);
    try {
      const result = await resetPasswordAction(data);
      if (!result.success) toast.error(result.error);
    } catch (_error) {
      toast.error(t("genericError"));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <AuthCard
      title={t("title")}
      description={t("description")}
      footer={
        <Link
          href={ROUTES.LOGIN}
          className="font-medium underline underline-offset-4 hover:text-primary"
        >
          {t("backToSignIn")}
        </Link>
      }
    >
      <div className="mb-4 flex justify-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <KeyRound className="h-6 w-6 text-muted-foreground" />
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">{t("newPassword")}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          {errors.password ? (
            <p className="text-sm text-destructive">
              {errors.password.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">{t("confirmNewPassword")}</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.confirmPassword}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword ? (
            <p className="text-sm text-destructive">
              {errors.confirmPassword.message}
            </p>
          ) : null}
        </div>

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
