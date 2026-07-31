"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/client-error-reporter";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errorBoundaries.root");

  useEffect(() => {
    reportClientError(error, "route");
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive" />
      <h1 className="mt-4 text-xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>
      <Button onClick={reset} className="mt-6">
        {t("tryAgain")}
      </Button>
    </div>
  );
}
