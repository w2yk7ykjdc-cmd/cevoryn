"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { setLocale } from "@/i18n/actions";
import type { Locale } from "@/i18n/request";

export function LanguageSelector() {
  const locale = useLocale();
  const t = useTranslations("language");
  const [isPending, startTransition] = useTransition();

  function handleChange(next: Locale) {
    startTransition(async () => {
      await setLocale(next);
    });
  }

  return (
    <label className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
      <Languages className="h-4 w-4" />
      <span className="sr-only">{t("label")}</span>
      <select
        value={locale}
        disabled={isPending}
        onChange={(event) => handleChange(event.target.value as Locale)}
        className="h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
        aria-label={t("label")}
      >
        <option value="en">{t("english")}</option>
        <option value="tr">{t("turkish")}</option>
      </select>
    </label>
  );
}
