"use client";

import { ArrowRight, Check, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const DISMISSED_KEY = "atlas:onboarding-guide-dismissed:v2";
const PROGRESS_KEY = "atlas:onboarding-guide-progress:v2";

const STEPS = [
  {
    id: "context",
    title: "Tell Atlas what matters",
    description: "Start a chat and explain your priorities, risks, and current goals.",
    href: "/chat?prompt=Help%20me%20set%20up%20Atlas.%20Ask%20me%20for%20our%20top%20goals%2C%20risks%2C%20and%20current%20priorities.",
  },
  {
    id: "brief",
    title: "Review the Morning Brief",
    description: "See the latest priorities, risks, and recommended next moves.",
    href: "/brief",
  },
  {
    id: "intelligence",
    title: "Open Intelligence",
    description: "Review decisions and prepared actions before approving execution.",
    href: "/intelligence",
  },
  {
    id: "team",
    title: "Invite your team",
    description: "Add the people who should share company context and decisions.",
    href: "/team",
  },
] as const;

type StepId = (typeof STEPS)[number]["id"];

export function OnboardingGuide() {
  const [visible, setVisible] = useState(false);
  const [completed, setCompleted] = useState<StepId[]>([]);

  useEffect(() => {
    try {
      setVisible(window.localStorage.getItem(DISMISSED_KEY) !== "true");
      const stored = JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? "[]") as unknown;
      if (Array.isArray(stored)) {
        setCompleted(stored.filter((value): value is StepId => STEPS.some((step) => step.id === value)));
      }
    } catch {
      setVisible(true);
    }
  }, []);

  function completeStep(id: StepId) {
    setCompleted((current) => {
      if (current.includes(id)) return current;
      const next = [...current, id];
      try {
        window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
      } catch {
        // Progress remains available for the current session.
      }
      return next;
    });
  }

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // Dismiss for the current session when storage is unavailable.
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-primary">Getting started</p>
          <CardTitle className="mt-1 text-lg">Set up Atlas in four steps</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {completed.length} of {STEPS.length} steps opened. Atlas becomes more useful as company context grows.
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={dismiss} aria-label="Dismiss onboarding guide">
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {STEPS.map((step, index) => {
          const isComplete = completed.includes(step.id);
          return (
            <Link
              key={step.id}
              href={step.href}
              onClick={() => completeStep(step.id)}
              className={cn(
                "group rounded-lg border bg-background p-4 transition-colors hover:bg-muted/50",
                isComplete && "border-primary/30 bg-primary/5"
              )}
            >
              <div className="flex items-start gap-3">
                <div className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  isComplete ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}>
                  {isComplete ? <Check className="h-4 w-4" /> : index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{step.title}</p>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                </div>
              </div>
            </Link>
          );
        })}
        <p className="text-xs text-muted-foreground md:col-span-2">
          A step is marked complete when you open it. You can return and continue at any time.
        </p>
      </CardContent>
    </Card>
  );
}
