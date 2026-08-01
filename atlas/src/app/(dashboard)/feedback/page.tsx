import { Bug, Lightbulb, Mail, MessageSquare } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Feedback — CEVORYN" };

const FEEDBACK_EMAIL = "kemalkiyak06@icloud.com";

const FEEDBACK_OPTION_KEYS = [
  "reportProblem",
  "suggestImprovement",
  "generalFeedback",
] as const;

const FEEDBACK_ICONS = {
  reportProblem: Bug,
  suggestImprovement: Lightbulb,
  generalFeedback: MessageSquare,
} as const;

export default async function FeedbackPage() {
  const t = await getTranslations("feedback");

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      <div>
        <p className="text-sm text-muted-foreground">{t("privateBeta")}</p>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {FEEDBACK_OPTION_KEYS.map((key) => {
          const Icon = FEEDBACK_ICONS[key];
          const subject = t(`options.${key}.subject`);
          const href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(t("bodyTemplate"))}`;

          return (
            <Card key={key}>
              <CardHeader className="space-y-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">
                  {t(`options.${key}.title`)}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t(`options.${key}.description`)}
                </p>
                <Button asChild className="w-full">
                  <a href={href}>
                    <Mail className="h-4 w-4" />
                    {t("sendFeedback")}
                  </a>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="py-5 text-sm text-muted-foreground">
          {t("sensitiveWarning")}
        </CardContent>
      </Card>
    </div>
  );
}
