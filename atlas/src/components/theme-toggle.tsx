"use client";

import { Moon, Sun } from "lucide-react";

import { useLanguage } from "@/components/language-provider";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { t } = useLanguage();
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2"
      onClick={toggleTheme}
      aria-label={isDark ? t("switchToLight") : t("switchToDark")}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      {isDark ? t("lightMode") : t("darkMode")}
    </Button>
  );
}
