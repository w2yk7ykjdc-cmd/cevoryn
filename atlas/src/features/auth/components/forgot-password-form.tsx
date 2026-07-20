"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/lib/constants";

import { forgotPasswordAction } from "../actions/auth";
import { forgotPasswordSchema } from "../schemas/auth";
import type { ForgotPasswordInput } from "../schemas/auth";

import { AuthCard } from "./auth-card";

export function ForgotPasswordForm() {
  const [isPending, setIsPending] = useState(false);
  const [isSent, setIsSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
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
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  if (isSent) {
    return (
      <AuthCard
        title="Check your email"
        description="We sent a password reset link"
      >
        <div className="flex flex-col items-center gap-4 py-4">
          <Mail className="h-12 w-12 text-muted-foreground" />
          <p className="text-center text-sm text-muted-foreground">
            If an account exists with that email, you will receive a reset link
            shortly.
          </p>
          <Link href={ROUTES.LOGIN}>
            <Button variant="outline">
              <ArrowLeft />
              Back to sign in
            </Button>
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset password"
      description="Enter your email to receive a reset link"
      footer={
        <Link
          href={ROUTES.LOGIN}
          className="inline-flex items-center gap-1 font-medium underline underline-offset-4 hover:text-primary"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to sign in
        </Link>
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

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending && <Loader2 className="animate-spin" />}
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}
