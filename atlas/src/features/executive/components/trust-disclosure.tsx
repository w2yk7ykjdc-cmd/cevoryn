"use client";

import { ChevronDown, ChevronUp, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { Evidence } from "@/features/brain/trust/types";
import { getConfidenceLevel } from "@/features/brain/trust/types";
import { sendAnalyticsEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

interface TrustDisclosureProps {
  confidence: number;
  reasoning: string;
  evidence: Evidence[];
  missingInformation: string[];
}

const CONFIDENCE_STYLES = {
  high: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  medium:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  low: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  insufficient: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
} as const;

export function TrustDisclosure({
  confidence,
  reasoning,
  evidence,
  missingInformation,
}: TrustDisclosureProps) {
  const t = useTranslations("executive.trustDisclosure");
  const [isOpen, setIsOpen] = useState(false);
  const level = getConfidenceLevel(confidence);
  const pct = Math.round(confidence * 100);

  function handleToggle() {
    const next = !isOpen;
    setIsOpen(next);
    if (next) {
      sendAnalyticsEvent("evidence_opened");
    }
  }

  return (
    <div className="rounded-lg border bg-muted/30">
      <button
        onClick={handleToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
        aria-expanded={isOpen}
      >
        <Info
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="flex-1 text-muted-foreground">
          {t("whyCevorynThinks")}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            CONFIDENCE_STYLES[level]
          )}
        >
          {t("confidence", { pct })}
        </span>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {isOpen && (
        <div className="animate-fade-in space-y-3 border-t px-3 py-3 text-sm">
          {/* Reasoning */}
          {reasoning && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("reasoning")}
              </p>
              <p className="text-foreground">{reasoning}</p>
            </div>
          )}

          {/* Evidence */}
          {evidence.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("evidence", { count: evidence.length })}
              </p>
              <ul className="space-y-1.5">
                {evidence.map((e, i) => (
                  <li
                    key={i}
                    className="rounded-md bg-background px-2.5 py-1.5 text-xs"
                  >
                    <span className="font-medium capitalize">{e.source}</span>
                    <span className="text-muted-foreground"> — </span>
                    <span>{e.excerpt}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Missing information */}
          {missingInformation.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("missingInformation")}
              </p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {missingInformation.map((info, i) => (
                  <li key={i}>• {info}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Inline confidence badge for compact views */
export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const level = getConfidenceLevel(confidence);
  const pct = Math.round(confidence * 100);

  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        CONFIDENCE_STYLES[level]
      )}
    >
      {pct}%
    </span>
  );
}
