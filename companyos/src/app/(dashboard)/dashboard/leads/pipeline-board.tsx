"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Stage = { id: string; name: string; isWon: boolean; isLost: boolean };
type Lead = {
  id: string;
  title: string;
  value: number;
  probability: number;
  stageId: string;
  companyName: string | null;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function PipelineBoard({ stages, leads }: { stages: Stage[]; leads: Lead[] }) {
  return (
    <div
      className="flex gap-4 overflow-x-auto pb-2"
      role="group"
      aria-label="Lead pipeline, grouped by stage"
    >
      {stages.map((stage) => {
        const stageLeads = leads.filter((lead) => lead.stageId === stage.id);
        const stageValue = stageLeads.reduce((sum, lead) => sum + lead.value, 0);

        return (
          <section
            key={stage.id}
            aria-label={`${stage.name} stage, ${stageLeads.length} leads`}
            className="flex w-72 shrink-0 flex-col gap-3"
          >
            <div className="flex items-center justify-between px-1">
              <h2
                className={cn(
                  "text-sm font-semibold",
                  stage.isWon && "text-green-600 dark:text-green-400",
                  stage.isLost && "text-destructive",
                )}
              >
                {stage.name}
              </h2>
              <span className="text-xs text-muted-foreground">
                {stageLeads.length} · {currencyFormatter.format(stageValue)}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {stageLeads.length === 0 && (
                <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                  No leads
                </p>
              )}
              {stageLeads.map((lead) => (
                <Link key={lead.id} href={`/dashboard/leads/${lead.id}`}>
                  <Card className="transition-colors hover:bg-accent">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">{lead.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between pb-3 text-xs text-muted-foreground">
                      <span>{lead.companyName ?? "No company"}</span>
                      <div className="flex items-center gap-2">
                        <span>{currencyFormatter.format(lead.value)}</span>
                        <Badge variant="outline">{lead.probability}%</Badge>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
