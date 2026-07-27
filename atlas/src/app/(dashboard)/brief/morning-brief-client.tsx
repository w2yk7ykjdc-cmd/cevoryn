"use client";

import {
  ArrowRight,
  Brain,
  CheckCircle2,
  FileText,
  Lightbulb,
  Loader2,
  Minus,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { BriefSection } from "@/features/brain/core/types";
import { cn } from "@/lib/utils";

interface FocusItem {
  id: string;
  title: string;
  summary: string;
  severity: string;
  recommendedAction: string;
}

interface NextAction {
  id: string;
  title: string;
  description: string;
}

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
  focusItems: FocusItem[];
  nextActions: NextAction[];
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
  focusItems,
  nextActions,
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
    <div className="mx-auto max-w-4xl space-y-6 pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Morning Brief</p>
          <h1 className="text-2xl font-bold tracking-tight">
            {briefTitle ?? `Good morning, ${displayName.split(" ")[0]}`}
          </h1>
          {briefDate && <p className="text-sm text-muted-foreground">{briefDate}</p>}
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/chat">
            Ask CEVORYN <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-primary/20 bg-primary/5">
              <span className="text-xl font-bold">{pulse.score}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
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
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {pulse.dimensions.map((dimension) => (
                  <div key={dimension.name} className="text-xs">
                    <span className="text-muted-foreground">{dimension.name}</span>
                    <span className="ml-1 font-medium">{dimension.score}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4" /> Today&apos;s focus
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {focusItems.length > 0 ? (
              focusItems.map((item, index) => (
                <div key={item.id} className="rounded-lg border p-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{item.title}</p>
                        <Badge variant={item.severity === "CRITICAL" ? "destructive" : "secondary"} className="text-[10px]">
                          {item.severity}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{item.summary}</p>
                      {item.recommendedAction && (
                        <p className="mt-2 text-sm font-medium">Next: {item.recommendedAction}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No urgent focus items today.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Prepared next actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {nextActions.length > 0 ? (
              nextActions.map((action) => (
                <div key={action.id} className="rounded-lg bg-muted/50 p-3">
                  <p className="text-sm font-medium">{action.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{action.description}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No prepared actions waiting.</p>
            )}
            <Button asChild variant="ghost" size="sm" className="w-full justify-between">
              <Link href="/dashboard">
                Open command center <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

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

      {sections.length > 0 ? (
        <div className="space-y-3">
          {sections.map((section, index) => {
            const Icon = PRIORITY_ICON[section.priority] ?? Lightbulb;
            return (
              <Card key={`${section.heading}-${index}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      <CardTitle className="text-base">{section.heading}</CardTitle>
                    </div>
                    <Badge variant={section.priority === "high" ? "destructive" : "secondary"} className="text-[10px]">
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
              <p className="font-medium">{hasBrief ? "Brief is empty" : "No brief yet"}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Generate your first morning brief from CEVORYN Brain.
              </p>
            </div>
            <Button onClick={handleGenerate} disabled={isGenerating || isPending}>
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              Generate Brief
            </Button>
          </CardContent>
        </Card>
      )}

      {sections.length > 0 && (
        <>
          <Separator />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Brief generated by CEVORYN Brain</p>
            <Button variant="ghost" size="sm" onClick={handleGenerate} disabled={isGenerating}>
              Refresh
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
