"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { reportClientError } from "@/lib/client-error-reporter";

export default function IntelligenceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errorBoundaries.intelligence");

  useEffect(() => {
    reportClientError(error, "route");
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-12">
      <Card>
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("description")}</p>
          <Button onClick={reset}>
            <RotateCcw className="h-4 w-4" />
            {t("tryAgain")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
