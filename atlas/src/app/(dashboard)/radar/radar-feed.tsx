"use client";

import { AlertTriangle, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import type { OpportunityCardData } from "./opportunity-card";
import { OpportunityCard } from "./opportunity-card";

interface EventRow {
  id: string;
  type: string;
  title: string;
  description: string;
  confidence: number;
  occurredAt: Date;
  externalEntity: { id: string; name: string };
}

interface RadarFeedProps {
  canManage: boolean;
  opportunities: OpportunityCardData[];
  threats: OpportunityCardData[];
  events: EventRow[];
}

export function RadarFeed({
  canManage,
  opportunities,
  threats,
  events,
}: RadarFeedProps) {
  const t = useTranslations("radar");
  const isEmpty =
    opportunities.length === 0 && threats.length === 0 && events.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Link
          href="/radar/watchlist"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {t("watchlist")}
        </Link>
      </div>

      {isEmpty ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("empty")}
          </CardContent>
        </Card>
      ) : (
        <>
          {threats.length > 0 ? (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                {t("threats")}
                <Badge variant="destructive">{threats.length}</Badge>
              </h2>
              {threats.map((threat) => (
                <OpportunityCard
                  key={threat.id}
                  opportunity={threat}
                  canManage={canManage}
                />
              ))}
            </section>
          ) : null}

          {opportunities.length > 0 ? (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
                {t("opportunities")}
                <Badge variant="secondary">{opportunities.length}</Badge>
              </h2>
              {opportunities.map((opportunity) => (
                <OpportunityCard
                  key={opportunity.id}
                  opportunity={opportunity}
                  canManage={canManage}
                />
              ))}
            </section>
          ) : null}

          {events.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t("events")}
              </h2>
              <Card>
                <CardContent className="divide-y p-0">
                  {events.map((event) => (
                    <div key={event.id} className="p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {event.externalEntity.name} —{" "}
                          {event.type.replaceAll("_", " ")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {Math.round(event.confidence * 100)}%
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {event.title}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
