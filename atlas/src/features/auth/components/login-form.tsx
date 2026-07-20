"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/lib/constants";

import { loginAction } from "../actions/auth";
import { loginSchema } from "../schemas/auth";
import type { LoginInput } from "../schemas/auth";

import { AuthCard } from "./auth-card";

interface LoginFormProps {
  redirectTo?: string;
  authError?: string;
}

export function LoginForm({ redirectTo, authError }: LoginFormProps) {
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (authError)
      toast.error(
        "Your sign-in link expired or is invalid. Please sign in again."
      );
  }, [authError]);

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
      // If loginAction succeeds, it redirects — we only get here on error
      if (!result.success) {
        toast.error(result.error);
        if (result.fieldErrors) {
          Object.entries(result.fieldErrors).forEach(([field, messages]) => {
            setError(field as keyof LoginInput, {
              message: messages[0],
            });
          });
        }
      }
    } catch (_error) {
      // Server action redirect throws NEXT_REDIRECT — expected on success
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
            href={ROUTES.SIGNUP}
            className="font-medium underline underline-offset-4 hover:text-primary"
          >
            Sign up
          </Link>
        </>
      }
    >
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
