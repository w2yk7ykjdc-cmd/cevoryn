"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/client-error-reporter";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errorBoundaries.auth");

  useEffect(() => {
    reportClientError(error, "route");
  }, [error]);

  return (
    <div className="flex w-full max-w-md flex-col items-center justify-center rounded-xl border bg-card px-6 py-12 text-center shadow-sm">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-7 w-7 text-destructive" />
      </div>
      <h1 className="mt-5 text-xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("reference", { digest: error.digest })}
        </p>
      ) : null}
      <Button onClick={reset} className="mt-6">
        <RotateCcw className="h-4 w-4" />
        {t("tryAgain")}
      </Button>
    </div>
  );
}
