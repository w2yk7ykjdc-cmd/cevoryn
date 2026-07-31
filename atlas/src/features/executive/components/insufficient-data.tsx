"use client";

import { ArrowRight, BookOpen, Database, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface InsufficientDataProps {
  reasons: string[];
}

export function InsufficientData({ reasons }: InsufficientDataProps) {
  const t = useTranslations("executive.insufficientData");

  const starterSteps = [
    {
      title: t("step1Title"),
      description: t("step1Description"),
      href: "/chat",
      label: t("step1Label"),
      icon: MessageSquare,
    },
    {
      title: t("step2Title"),
      description: t("step2Description"),
      href: "/brief",
      label: t("step2Label"),
      icon: BookOpen,
    },
  ];

  return (
    <Card>
      <CardContent className="space-y-6 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Database className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-lg font-semibold">{t("heading")}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {t("subheading")}
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          {starterSteps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={step.href} className="rounded-xl border p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
                    {index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-primary" />
                      <p className="text-sm font-medium">{step.title}</p>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {step.description}
                    </p>
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="mt-3 h-8 text-xs"
                    >
                      <Link href={step.href}>
                        {step.label}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {reasons.length > 0 && (
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("stillMissing")}
            </p>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {reasons.map((reason, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
