"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/lib/constants";

import { resendConfirmationAction, signupAction } from "../actions/auth";
import { createSignupSchema } from "../schemas/auth";
import type { SignupInput } from "../schemas/auth";

import { AuthCard } from "./auth-card";

interface SignupFormProps {
  redirectTo?: string;
}

export function SignupForm({ redirectTo }: SignupFormProps) {
  const t = useTranslations("auth.signup");
  const tValidation = useTranslations("auth.validation");
  const [isPending, setIsPending] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [isConfirmation, setIsConfirmation] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const loginHref = redirectTo
    ? `${ROUTES.LOGIN}?next=${encodeURIComponent(redirectTo)}`
    : ROUTES.LOGIN;

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<SignupInput>({
    resolver: zodResolver(
      createSignupSchema({
        invalidEmail: tValidation("invalidEmail"),
        passwordMinLength: tValidation("passwordMinLength"),
        passwordComplexity: tValidation("passwordComplexity"),
        passwordsDoNotMatch: tValidation("passwordsDoNotMatch"),
      })
    ),
    defaultValues: { email: "", password: "", confirmPassword: "" },
  });

  async function onSubmit(data: SignupInput) {
    setIsPending(true);
    try {
      const result = await signupAction(data, redirectTo);
      if (result.success) {
        setConfirmationEmail(data.email);
        setIsConfirmation(true);
      } else {
        toast.error(result.error);
        if (result.fieldErrors) {
          Object.entries(result.fieldErrors).forEach(([field, messages]) => {
            setError(field as keyof SignupInput, {
              message: messages[0],
            });
          });
        }
      }
    } catch (_error) {
      toast.error(t("genericError"));
    } finally {
      setIsPending(false);
    }
  }

  async function onResendConfirmation() {
    if (!confirmationEmail) return;

    setIsResending(true);
    try {
      const result = await resendConfirmationAction(
        { email: confirmationEmail },
        redirectTo
      );

      if (result.success) {
        toast.success(t("resendSuccess"));
      } else {
        toast.error(result.error);
      }
    } catch (_error) {
      toast.error(t("genericError"));
    } finally {
      setIsResending(false);
    }
  }

  if (isConfirmation) {
    return (
      <AuthCard
        title={t("checkEmailTitle")}
        description={t("checkEmailDescription")}
      >
        <div className="flex flex-col items-center gap-4 py-4">
          <CheckCircle2 className="h-12 w-12 text-green-500" />
          <p className="text-center text-sm text-muted-foreground">
            {t.rich("checkEmailBody", {
              email: confirmationEmail,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={onResendConfirmation}
            disabled={isResending}
          >
            {isResending && <Loader2 className="animate-spin" />}
            {t("resend")}
          </Button>
          <Link href={loginHref}>
            <Button variant="ghost">{t("backToSignIn")}</Button>
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
        <>
          {t("haveAccount")}{" "}
          <Link
            href={loginHref}
            className="font-medium underline underline-offset-4 hover:text-primary"
          >
            {t("signInLink")}
          </Link>
        </>
      }
    >
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

        <div className="space-y-2">
          <Label htmlFor="password">{t("password")}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          {errors.password && (
            <p className="text-sm text-destructive">
              {errors.password.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.confirmPassword}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <p className="text-sm text-destructive">
              {errors.confirmPassword.message}
            </p>
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
