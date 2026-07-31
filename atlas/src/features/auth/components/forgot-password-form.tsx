"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, ArrowLeft, Loader2, Mail } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/lib/constants";

import { forgotPasswordAction } from "../actions/auth";
import { createForgotPasswordSchema } from "../schemas/auth";
import type { ForgotPasswordInput } from "../schemas/auth";

import { AuthCard } from "./auth-card";

interface ForgotPasswordFormProps {
  resetLinkError?: boolean;
}

export function ForgotPasswordForm({
  resetLinkError = false,
}: ForgotPasswordFormProps) {
  const t = useTranslations("auth.forgotPassword");
  const tValidation = useTranslations("auth.validation");
  const [isPending, setIsPending] = useState(false);
  const [isSent, setIsSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(
      createForgotPasswordSchema({
        invalidEmail: tValidation("invalidEmail"),
        passwordMinLength: tValidation("passwordMinLength"),
        passwordComplexity: tValidation("passwordComplexity"),
        passwordsDoNotMatch: tValidation("passwordsDoNotMatch"),
      })
    ),
    defaultValues: { email: "" },
  });

  async function onSubmit(data: ForgotPasswordInput) {
    setIsPending(true);
    try {
      const result = await forgotPasswordAction(data);
      if (result.success) {
        setIsSent(true);
      } else {
        toast.error(result.error);
      }
    } catch (_error) {
      toast.error(t("genericError"));
    } finally {
      setIsPending(false);
    }
  }

  if (isSent) {
    return (
      <AuthCard
        title={t("checkEmailTitle")}
        description={t("checkEmailDescription")}
      >
        <div className="flex flex-col items-center gap-4 py-4">
          <Mail className="h-12 w-12 text-muted-foreground" />
          <p className="text-center text-sm text-muted-foreground">
            {t("checkEmailBody")}
          </p>
          <Link href={ROUTES.LOGIN}>
            <Button variant="outline">
              <ArrowLeft />
              {t("backToSignIn")}
            </Button>
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("title")}
      description={t("description")}
      footer={
        <Link
          href={ROUTES.LOGIN}
          className="inline-flex items-center gap-1 font-medium underline underline-offset-4 hover:text-primary"
        >
          <ArrowLeft className="h-3 w-3" />
          {t("backToSignIn")}
        </Link>
      }
    >
      {resetLinkError && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p>{t("linkExpired")}</p>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            aria-invalid={!!errors.email}
            {...register("email")}
          />
          {errors.email && (
            <p className="text-sm text-destructive">{errors.email.message}</p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending && <Loader2 className="animate-spin" />}
          {t("submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
