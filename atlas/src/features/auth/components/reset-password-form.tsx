"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/lib/constants";

import { resetPasswordAction } from "../actions/reset-password";
import { resetPasswordSchema } from "../schemas/auth";
import type { ResetPasswordInput } from "../schemas/auth";

import { AuthCard } from "./auth-card";

export function ResetPasswordForm() {
  const [isPending, setIsPending] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  async function onSubmit(data: ResetPasswordInput) {
    setIsPending(true);
    try {
      const result = await resetPasswordAction(data);
      if (!result.success) toast.error(result.error);
    } catch (_error) {
      toast.error("Something went wrong. Please request a new reset link.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="Use at least 8 characters, including uppercase, lowercase, and a number"
      footer={
        <Link href={ROUTES.LOGIN} className="font-medium underline underline-offset-4 hover:text-primary">
          Back to sign in
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
          <Label htmlFor="password">New password</Label>
          <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register("password")} />
          {errors.password ? <p className="text-sm text-destructive">{errors.password.message}</p> : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input id="confirmPassword" type="password" autoComplete="new-password" aria-invalid={!!errors.confirmPassword} {...register("confirmPassword")} />
          {errors.confirmPassword ? <p className="text-sm text-destructive">{errors.confirmPassword.message}</p> : null}
        </div>

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}
