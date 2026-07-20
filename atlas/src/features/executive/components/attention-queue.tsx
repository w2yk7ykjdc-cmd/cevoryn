import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

import type { AttentionItem } from "../types";

import { ConfidenceBadge } from "./trust-disclosure";

interface AttentionQueueProps {
  items: AttentionItem[];
}

export function AttentionQueue({ items }: AttentionQueueProps) {
  if (items.length === 0) return null;

  return (
    <section aria-label="Items requiring attention">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Also needs attention
      </h2>
      <div className="space-y-2">
        {items.map((item) => (
          <AttentionCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function AttentionCard({ item }: { item: AttentionItem }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {item.type}
              </Badge>
              <ConfidenceBadge confidence={item.confidence} />
            </div>
            <p className="text-sm font-medium leading-tight">{item.title}</p>
            {item.summary && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {item.summary}
              </p>
            )}
          </div>
        </div>
        {item.recommendedAction && (
          <p className="mt-2 text-xs text-primary">
            → {item.recommendedAction}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
