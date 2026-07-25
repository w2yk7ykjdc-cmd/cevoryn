"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/lib/constants";

import { googleLoginAction, loginAction } from "../actions/auth";
import { loginSchema } from "../schemas/auth";
import type { LoginInput } from "../schemas/auth";

import { AuthCard } from "./auth-card";

interface LoginFormProps {
  redirectTo?: string;
  authError?: string;
  passwordReset?: boolean;
}

export function LoginForm({
  redirectTo,
  authError,
  passwordReset = false,
}: LoginFormProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const signupHref = redirectTo
    ? `${ROUTES.SIGNUP}?next=${encodeURIComponent(redirectTo)}`
    : ROUTES.SIGNUP;

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(data: LoginInput) {
    setIsPending(true);

    try {
      const result = await loginAction(data, redirectTo);
      if (!result.success) {
        toast.error(result.error);
        if (result.fieldErrors) {
          Object.entries(result.fieldErrors).forEach(([field, messages]) => {
            setError(field as keyof LoginInput, {
              message: messages[0],
            });
          });
        }
        return;
      }

      const target = result.data || ROUTES.DASHBOARD;
      router.prefetch(target);
      router.replace(target);
    } catch (error) {
      console.error("Login failed:", error);
      toast.error("Unable to sign in. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <AuthCard
      title="Sign in"
      description="Enter your credentials to access your workspace"
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link
            href={signupHref}
            className="font-medium underline underline-offset-4 hover:text-primary"
          >
            Sign up
          </Link>
        </>
      }
    >
      {passwordReset && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Your password has been updated. Sign in with your new password.</p>
        </div>
      )}

      {authError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {authError}
        </p>
      )}

      <form action={googleLoginAction} className="mb-4">
        {redirectTo && (
          <input type="hidden" name="redirectTo" value={redirectTo} />
        )}
        <Button type="submit" variant="outline" className="w-full">
          Continue with Google
        </Button>
      </form>

      <div className="relative mb-4">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">or</span>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "email-error" : undefined}
            {...register("email")}
          />
          {errors.email && (
            <p id="email-error" className="text-sm text-destructive">
              {errors.email.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href={ROUTES.FORGOT_PASSWORD}
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...register("password")}
          />
          {errors.password && (
            <p id="password-error" className="text-sm text-destructive">
              {errors.password.message}
            </p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending && <Loader2 className="animate-spin" />}
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
