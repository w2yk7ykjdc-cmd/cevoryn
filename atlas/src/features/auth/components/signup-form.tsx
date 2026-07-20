"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/lib/constants";

import { signupAction } from "../actions/auth";
import { signupSchema } from "../schemas/auth";
import type { SignupInput } from "../schemas/auth";

import { AuthCard } from "./auth-card";

export function SignupForm() {
  const [isPending, setIsPending] = useState(false);
  const [isConfirmation, setIsConfirmation] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: "", password: "", confirmPassword: "" },
  });

  async function onSubmit(data: SignupInput) {
    setIsPending(true);
    try {
      const result = await signupAction(data);
      if (result.success) {
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
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  if (isConfirmation) {
    return (
      <AuthCard
        title="Check your email"
        description="We sent you a confirmation link"
      >
        <div className="flex flex-col items-center gap-4 py-4">
          <CheckCircle2 className="h-12 w-12 text-green-500" />
          <p className="text-center text-sm text-muted-foreground">
            Click the link in your email to activate your account, then return
            here to sign in.
          </p>
          <Link href={ROUTES.LOGIN}>
            <Button variant="outline">Back to sign in</Button>
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create an account"
      description="Get started with Atlas for your team"
      footer={
        <>
          Already have an account?{" "}
          <Link
            href={ROUTES.LOGIN}
            className="font-medium underline underline-offset-4 hover:text-primary"
          >
            Sign in
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
            {...register("email")}
          />
          {errors.email && (
            <p className="text-sm text-destructive">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
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
          <Label htmlFor="confirmPassword">Confirm password</Label>
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
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
