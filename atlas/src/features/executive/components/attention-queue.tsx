"use client";

import { ArrowRight, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { sendAnalyticsEvent } from "@/lib/analytics";

import type { AttentionItem } from "../types";

import { ConfidenceBadge } from "./trust-disclosure";

interface AttentionQueueProps {
  items: AttentionItem[];
}

export function AttentionQueue({ items }: AttentionQueueProps) {
  const t = useTranslations("executive.attentionQueue");

  if (items.length === 0) return null;

  return (
    <section aria-label={t("heading")}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {t("heading")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("subheading")}
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {t("pending", { count: items.length })}
        </Badge>
      </div>

      <div className="space-y-3">
        {items.map((item, index) => (
          <AttentionCard key={item.id} item={item} rank={index + 2} />
        ))}
      </div>
    </section>
  );
}

function AttentionCard({ item, rank }: { item: AttentionItem; rank: number }) {
  const t = useTranslations("executive.attentionQueue");
  const prompt = encodeURIComponent(
    t("chatPrompt", {
      type: item.type,
      title: item.title,
      action: item.recommendedAction || t("defaultRecommendedAction"),
    })
  );

  function trackDiscussion() {
    sendAnalyticsEvent("attention_item_discussed", {
      id: item.id,
      type: item.type,
      rank,
    });
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
            {rank}
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="shrink-0 text-[10px] uppercase"
              >
                {item.type}
              </Badge>
              <ConfidenceBadge confidence={item.confidence} />
            </div>

            <p className="text-sm font-medium leading-tight">{item.title}</p>

            {item.summary && (
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {item.summary}
              </p>
            )}

            {item.recommendedAction && (
              <div className="mt-3 rounded-md bg-muted/50 p-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("suggestedMove")}
                </p>
                <p className="mt-1 text-xs">{item.recommendedAction}</p>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                asChild
                size="sm"
                variant="outline"
                onClick={trackDiscussion}
              >
                <Link href={`/chat?prompt=${prompt}`}>
                  <MessageSquare className="h-3.5 w-3.5" />
                  {t("discuss")}
                </Link>
              </Button>

              <Button asChild size="sm" variant="ghost">
                <Link href={item.type === "decision" ? "/dashboard" : "/brief"}>
                  {t("reviewContext")}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
