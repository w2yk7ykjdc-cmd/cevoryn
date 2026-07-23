"use client";

import { Languages } from "lucide-react";

import { useLanguage } from "@/components/language-provider";

export function LanguageSelector() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <label className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
      <Languages className="h-4 w-4" />
      <span className="sr-only">{t("language")}</span>
      <select
        value={language}
        onChange={(event) => setLanguage(event.target.value === "tr" ? "tr" : "en")}
        className="h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
        aria-label={t("language")}
      >
        <option value="en">{t("english")}</option>
        <option value="tr">{t("turkish")}</option>
      </select>
    </label>
  );
}
