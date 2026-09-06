"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { reportClientError } from "@/lib/client-error-reporter";

export default function RadarError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("radar");

  useEffect(() => {
    reportClientError(error, "route");
  }, [error]);

  return (
    <Card className="mx-auto max-w-xl">
      <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">{t("errorTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("errorDescription")}
          </p>
        </div>
        <Button onClick={reset}>
          <RotateCcw className="h-4 w-4" />
          {t("tryAgain")}
        </Button>
      </CardContent>
    </Card>
  );
}
