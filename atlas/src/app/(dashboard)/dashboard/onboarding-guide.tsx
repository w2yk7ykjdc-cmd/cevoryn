"use client";

import { ArrowRight, CheckCircle2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STORAGE_KEY = "atlas:onboarding-guide-dismissed:v1";

const STEPS = [
  {
    title: "Tell Atlas what matters",
    description: "Start a chat and explain your priorities, risks, and current goals.",
    href: "/chat?prompt=Help%20me%20set%20up%20Atlas.%20Ask%20me%20for%20our%20top%20goals%2C%20risks%2C%20and%20current%20priorities.",
  },
  {
    title: "Review the Morning Brief",
    description: "See the latest priorities, risks, and recommended next moves.",
    href: "/brief",
  },
  {
    title: "Open Intelligence",
    description: "Review decisions and prepared actions before approving execution.",
    href: "/intelligence",
  },
  {
    title: "Invite your team",
    description: "Add the people who should share company context and decisions.",
    href: "/team",
  },
] as const;

export function OnboardingGuide() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(window.localStorage.getItem(STORAGE_KEY) !== "true");
  }, []);

  function dismiss() {
    window.localStorage.setItem(STORAGE_KEY, "true");
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
            Complete this short path so Atlas can move from generic advice to company-specific decisions.
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={dismiss} aria-label="Dismiss onboarding guide">
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {STEPS.map((step, index) => (
          <Link
            key={step.href}
            href={step.href}
            className="group rounded-lg border bg-background p-4 transition-colors hover:bg-muted/50"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {index + 1}
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
        ))}
        <div className="flex items-center gap-2 text-xs text-muted-foreground md:col-span-2">
          <CheckCircle2 className="h-4 w-4" />
          You can dismiss this guide and continue using Atlas normally.
        </div>
      </CardContent>
    </Card>
  );
}
