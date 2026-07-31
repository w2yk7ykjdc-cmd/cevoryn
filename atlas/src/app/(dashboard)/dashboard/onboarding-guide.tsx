"use client";

import { ArrowRight, Check, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OnboardingProgress } from "@/features/executive/types";
import { cn } from "@/lib/utils";

const DISMISSED_KEY = "atlas:onboarding-guide-dismissed:v3";

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
      title: "Workspace created",
      description: "Your CEVORYN workspace is set up and ready.",
      href: null,
      done: true,
    },
    {
      id: "googleConnected",
      title: "Connect Google",
      description: "Link Calendar and Gmail so CEVORYN can ground answers in real activity.",
      href: "/settings",
      done: progress.googleConnected,
    },
    {
      id: "teamInvited",
      title: "Invite your team",
      description: "Add the people who should share company context and decisions.",
      href: "/team",
      done: progress.teamInvited,
    },
    {
      id: "hasChatted",
      title: "Start your first chat",
      description: "Tell CEVORYN your priorities, risks, and current goals.",
      href: "/chat?prompt=Help%20me%20set%20up%20CEVORYN.%20Ask%20me%20for%20our%20top%20goals%2C%20risks%2C%20and%20current%20priorities.",
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
          <p className="text-xs font-medium uppercase tracking-wide text-primary">Getting started</p>
          <CardTitle className="mt-1 text-lg">Set up CEVORYN</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {completedCount} of {steps.length} steps done. CEVORYN becomes more useful as it learns about your company.
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={dismiss} aria-label="Dismiss onboarding guide">
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {steps.map((step, index) => {
          const content = (
            <div className="flex items-start gap-3">
              <div className={cn(
                "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                step.done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}>
                {step.done ? <Check className="h-4 w-4" /> : index + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{step.title}</p>
                  {step.href && !step.done && (
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
              </div>
            </div>
          );

          if (!step.href || step.done) {
            return (
              <div key={step.id} className={cn("rounded-lg border bg-background p-4", step.done && "border-primary/30 bg-primary/5")}>
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
          Steps complete automatically as you use CEVORYN - nothing to mark off by hand.
        </p>
      </CardContent>
    </Card>
  );
}
