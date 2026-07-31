"use client";

import {
  ArrowRight,
  BrainCircuit,
  ListChecks,
  MessageSquareText,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AttentionQueue } from "@/features/executive/components/attention-queue";
import { ExecutiveStatus } from "@/features/executive/components/executive-status";
import { InsufficientData } from "@/features/executive/components/insufficient-data";
import { QuietState } from "@/features/executive/components/quiet-state";
import { TodayActions } from "@/features/executive/components/today-actions";
import { TopPriority } from "@/features/executive/components/top-priority";
import type { ExecutiveHomeData } from "@/features/executive/types";
import { sendAnalyticsEvent } from "@/lib/analytics";

import { OnboardingGuide } from "./onboarding-guide";

interface ExecutiveHomeClientProps {
  data: ExecutiveHomeData;
}

const COMMANDS = [
  {
    href: "/chat",
    key: "chat",
    icon: MessageSquareText,
  },
  {
    href: "/brief",
    key: "brief",
    icon: Sparkles,
  },
  {
    href: "/health",
    key: "health",
    icon: BrainCircuit,
  },
] as const;

export function ExecutiveHomeClient({ data }: ExecutiveHomeClientProps) {
  const t = useTranslations("dashboard");

  useEffect(() => {
    sendAnalyticsEvent("executive_home_viewed");
  }, []);

  const openAttentionCount =
    data.attentionItems.length + (data.topPriority ? 1 : 0);
  const pendingActionCount = data.pendingActions.length;

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-8">
      <ExecutiveStatus
        greeting={data.greeting}
        dateLabel={data.dateLabel}
        pulse={data.pulse}
      />

      <OnboardingGuide progress={data.onboardingProgress} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("stats.attention")}
            </p>
            <p className="mt-1 text-2xl font-bold">{openAttentionCount}</p>
            <p className="text-xs text-muted-foreground">
              {t("stats.attentionCaption")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("stats.actions")}
            </p>
            <p className="mt-1 text-2xl font-bold">{pendingActionCount}</p>
            <p className="text-xs text-muted-foreground">
              {t("stats.actionsCaption")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("stats.knowledge")}
            </p>
            <p className="mt-1 text-2xl font-bold">{data.memoryCount}</p>
            <p className="text-xs text-muted-foreground">
              {t("stats.knowledgeCaption")}
            </p>
          </CardContent>
        </Card>
      </div>

      {data.state === "insufficient_data" && (
        <InsufficientData reasons={data.insufficientDataReasons} />
      )}

      {data.state === "quiet" && (
        <QuietState
          message={data.quietMessage}
          resolvedRecently={data.resolvedRecently}
          memoryCount={data.memoryCount}
        />
      )}

      {data.state === "active" && (
        <>
          {data.topPriority && <TopPriority item={data.topPriority} />}
          <AttentionQueue items={data.attentionItems} />
          <TodayActions actions={data.pendingActions} />
        </>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">
              {t("commandCenter.heading")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("commandCenter.subheading")}
            </p>
          </div>
          <ListChecks className="h-5 w-5 text-muted-foreground" />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {COMMANDS.map((command) => {
            const Icon = command.icon;
            return (
              <Card
                key={command.href}
                className="transition-colors hover:bg-muted/40"
              >
                <CardContent className="flex h-full flex-col p-4">
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                    <Icon className="h-4 w-4" />
                  </div>
                  <h3 className="font-semibold">
                    {t(`commands.${command.key}.title`)}
                  </h3>
                  <p className="mt-1 flex-1 text-sm text-muted-foreground">
                    {t(`commands.${command.key}.description`)}
                  </p>
                  <Button
                    asChild
                    variant="ghost"
                    className="mt-3 h-8 justify-start px-0"
                  >
                    <Link href={command.href}>
                      {t("commandCenter.open")}{" "}
                      <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
