"use client";

import { ArrowRight, Check, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OnboardingProgress } from "@/features/executive/types";
import { cn } from "@/lib/utils";

const DISMISSED_KEY = "cevoryn:onboarding-guide-dismissed:v4";

interface OnboardingGuideProps {
  progress: OnboardingProgress;
}

interface Step {
  id: keyof OnboardingProgress | "workspace";
  title: string;
  description: string;
  href: string | null;
  done: boolean;
}

export function OnboardingGuide({ progress }: OnboardingGuideProps) {
  const t = useTranslations("executive.onboardingGuide");
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISSED_KEY) === "true");
    } finally {
      setVisible(true);
    }
  }, []);

  const steps: Step[] = [
    {
      id: "workspace",
      title: t("workspace.title"),
      description: t("workspace.description"),
      href: null,
      done: true,
    },
    {
      id: "googleConnected",
      title: t("googleConnected.title"),
      description: t("googleConnected.description"),
      href: "/settings",
      done: progress.googleConnected,
    },
    {
      id: "teamInvited",
      title: t("teamInvited.title"),
      description: t("teamInvited.description"),
      href: "/team",
      done: progress.teamInvited,
    },
    {
      id: "hasChatted",
      title: t("hasChatted.title"),
      description: t("hasChatted.description"),
      href: `/chat?prompt=${encodeURIComponent(t("hasChatted.chatPrompt"))}`,
      done: progress.hasChatted,
    },
  ];

  const completedCount = steps.filter((step) => step.done).length;
  const allDone = completedCount === steps.length;

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // Dismiss for the current session when storage is unavailable.
    }
    setDismissed(true);
  }

  if (!visible || dismissed || allDone) return null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-primary">
            {t("eyebrow")}
          </p>
          <CardTitle className="mt-1 text-lg">{t("heading")}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("progress", { completed: completedCount, total: steps.length })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={dismiss}
          aria-label={t("dismiss")}
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {steps.map((step, index) => {
          const content = (
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  step.done
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {step.done ? <Check className="h-4 w-4" /> : index + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{step.title}</p>
                  {step.href && !step.done && (
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {step.description}
                </p>
              </div>
            </div>
          );

          if (!step.href || step.done) {
            return (
              <div
                key={step.id}
                className={cn(
                  "rounded-lg border bg-background p-4",
                  step.done && "border-primary/30 bg-primary/5"
                )}
              >
                {content}
              </div>
            );
          }

          return (
            <Link
              key={step.id}
              href={step.href}
              className="group rounded-lg border bg-background p-4 transition-colors hover:bg-muted/50"
            >
              {content}
            </Link>
          );
        })}
        <p className="text-xs text-muted-foreground md:col-span-2">
          {t("footer")}
        </p>
      </CardContent>
    </Card>
  );
}
