"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signOutAction } from "@/features/auth/actions/auth";
import { APP_CONFIG } from "@/lib/constants";

import { completeOnboardingAction } from "../actions/onboarding";
import { createOnboardingSchema } from "../schemas/onboarding";
import type { OnboardingInput } from "../schemas/onboarding";

interface OnboardingFormProps {
  userEmail: string;
}

export function OnboardingForm({ userEmail }: OnboardingFormProps) {
  const t = useTranslations("onboarding");
  const tValidation = useTranslations("onboarding.validation");
  const [isPending, setIsPending] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<OnboardingInput>({
    resolver: zodResolver(
      createOnboardingSchema({
        orgNameMin: tValidation("orgNameMin"),
        orgNameMax: tValidation("orgNameMax", {
          max: APP_CONFIG.orgNameMaxLength,
        }),
        nameMin: tValidation("nameMin"),
        nameMax: tValidation("nameMax", {
          max: APP_CONFIG.displayNameMaxLength,
        }),
      })
    ),
    defaultValues: {
      organizationName: "",
      displayName: userEmail.split("@")[0] ?? "",
    },
  });

  async function onSubmit(data: OnboardingInput) {
    setIsPending(true);
    try {
      const result = await completeOnboardingAction(data);
      if (!result.success) {
        toast.error(result.error);
        if (result.fieldErrors) {
          Object.entries(result.fieldErrors).forEach(([field, messages]) => {
            setError(field as keyof OnboardingInput, {
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
    <Card className="w-full max-w-lg">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Building2 className="h-7 w-7 text-primary" />
        </div>
        <CardTitle className="text-2xl">{t("heading")}</CardTitle>
        <CardDescription>{t("subheading")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="displayName">{t("yourName")}</Label>
            <Input
              id="displayName"
              placeholder="Jane Smith"
              autoComplete="name"
              aria-invalid={!!errors.displayName}
              {...register("displayName")}
            />
            {errors.displayName && (
              <p className="text-sm text-destructive">
                {errors.displayName.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="organizationName">{t("workspaceName")}</Label>
            <Input
              id="organizationName"
              placeholder="Acme Inc."
              aria-invalid={!!errors.organizationName}
              {...register("organizationName")}
            />
            {errors.organizationName && (
              <p className="text-sm text-destructive">
                {errors.organizationName.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {t("workspaceNameHelp")}
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending && <Loader2 className="animate-spin" />}
            {t("submit")}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          {t("signedInAs", { email: userEmail })}{" "}
          <form action={signOutAction} className="inline">
            <button type="submit" className="underline hover:text-foreground">
              {t("notYou")}
            </button>
          </form>
        </p>
      </CardContent>
    </Card>
  );
}
