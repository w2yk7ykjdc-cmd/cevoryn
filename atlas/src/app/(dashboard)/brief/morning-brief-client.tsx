"use client";

import {
  ArrowRight,
  BarChart3,
  Brain,
  CheckCircle2,
  FileText,
  Lightbulb,
  Loader2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Minus,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { BriefSection } from "@/features/brain/core/types";

interface MorningBriefClientProps {
  displayName: string;
  briefTitle: string | null;
  briefDate: string | null;
  sections: BriefSection[];
  pulse: {
    score: number;
    trend: "improving" | "stable" | "declining";
    dimensions: Array<{ name: string; score: number; description: string }>;
  };
  insightCount: number;
  actionCount: number;
  hasBrief: boolean;
}

const PRIORITY_ICON = {
  high: Sparkles,
  medium: Lightbulb,
  low: CheckCircle2,
} as const;

const TREND_ICON = {
  improving: TrendingUp,
  stable: Minus,
  declining: TrendingDown,
} as const;

export function MorningBriefClient({
  displayName,
  briefTitle,
  briefDate,
  sections,
  pulse,
  insightCount,
  actionCount,
  hasBrief,
}: MorningBriefClientProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleGenerate() {
    setIsGenerating(true);
    startTransition(async () => {
      try {
        const res = await fetch("/api/brain/brief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "DAILY" }),
        });
        if (res.ok) {
          toast.success("Brief generated");
          window.location.reload();
        } else {
          toast.error("Could not generate brief");
        }
      } catch (_error) {
        toast.error("Something went wrong");
      } finally {
        setIsGenerating(false);
      }
    });
  }

  const TrendIcon = TREND_ICON[pulse.trend];

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      {/* Header */}
      <div>
        <p className="text-sm text-muted-foreground">Morning Brief</p>
        <h1 className="text-2xl font-bold tracking-tight">
          {briefTitle ?? `Good morning, ${displayName.split(" ")[0]}`}
        </h1>
        {briefDate && (
          <p className="text-sm text-muted-foreground">{briefDate}</p>
        )}
      </div>

      {/* Pulse Summary */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-primary/20 bg-primary/5">
              <span className="text-xl font-bold">{pulse.score}</span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Company Pulse</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-xs font-medium",
                    pulse.trend === "improving"
                      ? "text-emerald-600"
                      : pulse.trend === "declining"
                        ? "text-amber-600"
                        : "text-muted-foreground"
                  )}
                >
                  <TrendIcon className="h-3 w-3" />
                  {pulse.trend}
                </span>
              </div>
              <div className="mt-2 flex gap-3">
                {pulse.dimensions.map((d) => (
                  <div key={d.name} className="text-xs">
                    <span className="text-muted-foreground">{d.name}</span>
                    <span className="ml-1 font-medium">{d.score}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <Link href="/dashboard">
          <Card className="transition-colors hover:bg-accent/50">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold">{insightCount}</p>
              <p className="text-xs text-muted-foreground">Insights</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/dashboard">
          <Card className="transition-colors hover:bg-accent/50">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold">{actionCount}</p>
              <p className="text-xs text-muted-foreground">Actions</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/health">
          <Card className="transition-colors hover:bg-accent/50">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold">{pulse.score}</p>
              <p className="text-xs text-muted-foreground">Health</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Brief sections */}
      {sections.length > 0 ? (
        <div className="space-y-3">
          {sections.map((section, i) => {
            const Icon = PRIORITY_ICON[section.priority] ?? Lightbulb;
            return (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon
                        className={cn(
                          "h-4 w-4",
                          section.priority === "high"
                            ? "text-amber-500"
                            : section.priority === "medium"
                              ? "text-blue-500"
                              : "text-emerald-500"
                        )}
                      />
                      <CardTitle className="text-base">
                        {section.heading}
                      </CardTitle>
                    </div>
                    <Badge
                      variant={
                        section.priority === "high"
                          ? "destructive"
                          : "secondary"
                      }
                      className="text-[10px]"
                    >
                      {section.priority}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                    {section.content}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">
                {hasBrief ? "Brief is empty" : "No brief yet"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Generate your first morning brief from Atlas Brain.
              </p>
            </div>
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || isPending}
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Brain className="h-4 w-4" />
              )}
              Generate Brief
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Footer CTA */}
      {sections.length > 0 && (
        <>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Brief generated by Atlas Brain
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleGenerate}
              disabled={isGenerating}
            >
              Refresh
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
