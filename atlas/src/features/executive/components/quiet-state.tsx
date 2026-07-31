"use client";

import {
  ArrowRight,
  CheckCircle2,
  MessageSquare,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface QuietStateProps {
  message: string;
  resolvedRecently: number;
  memoryCount: number;
}

export function QuietState({
  message,
  resolvedRecently,
  memoryCount,
}: QuietStateProps) {
  const t = useTranslations("executive.quietState");
  const growthPrompt = encodeURIComponent(t("growthChatPrompt"));

  return (
    <Card className="border-emerald-200 dark:border-emerald-900/50">
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-900/30">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="text-lg font-semibold">{t("heading")}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {message}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-muted/50 p-3">
            <p className="text-2xl font-semibold">{resolvedRecently}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("resolvedThisWeek")}
            </p>
          </div>
          <div className="rounded-xl bg-muted/50 p-3">
            <p className="text-2xl font-semibold">{memoryCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("memoriesAvailable")}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t("useQuietWindow")}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t("growthPrompt")}
              </p>
              <Button asChild size="sm" className="mt-3 h-8 text-xs">
                <Link href={`/chat?prompt=${growthPrompt}`}>
                  <MessageSquare className="h-3.5 w-3.5" />
                  {t("findNextMove")}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
