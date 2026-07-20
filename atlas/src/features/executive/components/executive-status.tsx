import { TrendingDown, TrendingUp, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

import type { PulseStatus } from "../types";

interface ExecutiveStatusProps {
  greeting: string;
  dateLabel: string;
  pulse: PulseStatus | null;
}

const TREND_CONFIG = {
  improving: {
    icon: TrendingUp,
    label: "Improving",
    color: "text-emerald-600 dark:text-emerald-400",
  },
  stable: { icon: Minus, label: "Stable", color: "text-muted-foreground" },
  declining: {
    icon: TrendingDown,
    label: "Declining",
    color: "text-amber-600 dark:text-amber-400",
  },
} as const;

export function ExecutiveStatus({
  greeting,
  dateLabel,
  pulse,
}: ExecutiveStatusProps) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{greeting}</h1>
        <p className="text-sm text-muted-foreground">{dateLabel}</p>
      </div>

      {pulse && (
        <div className="flex items-center gap-4 rounded-xl border bg-card p-4">
          {/* Pulse Score */}
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-primary/20">
            <span className="text-xl font-bold">{pulse.score}</span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Company Pulse</span>
              <TrendBadge trend={pulse.trend} />
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {pulse.statement}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function TrendBadge({
  trend,
}: {
  trend: "improving" | "stable" | "declining";
}) {
  const config = TREND_CONFIG[trend];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        config.color
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {config.label}
    </span>
  );
}
