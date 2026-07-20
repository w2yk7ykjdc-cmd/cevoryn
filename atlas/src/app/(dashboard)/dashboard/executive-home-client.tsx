"use client";

import { useEffect } from "react";

import { AttentionQueue } from "@/features/executive/components/attention-queue";
import { ExecutiveStatus } from "@/features/executive/components/executive-status";
import { InsufficientData } from "@/features/executive/components/insufficient-data";
import { QuietState } from "@/features/executive/components/quiet-state";
import { TodayActions } from "@/features/executive/components/today-actions";
import { TopPriority } from "@/features/executive/components/top-priority";
import type { ExecutiveHomeData } from "@/features/executive/types";
import { sendAnalyticsEvent } from "@/lib/analytics";

interface ExecutiveHomeClientProps {
  data: ExecutiveHomeData;
}

export function ExecutiveHomeClient({ data }: ExecutiveHomeClientProps) {
  // Track page view
  useEffect(() => {
    sendAnalyticsEvent("executive_home_viewed");
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      {/* Status */}
      <ExecutiveStatus
        greeting={data.greeting}
        dateLabel={data.dateLabel}
        pulse={data.pulse}
      />

      {/* State-specific content */}
      {data.state === "insufficient_data" && (
        <InsufficientData reasons={data.insufficientDataReasons} />
      )}

      {data.state === "quiet" && (
        <QuietState
          message={data.quietMessage}
          resolvedRecently={data.resolvedRecently}
          memoryCount={data.memoryCount}
        />
      )}

      {data.state === "active" && (
        <>
          {/* Top Priority */}
          {data.topPriority && <TopPriority item={data.topPriority} />}

          {/* Attention Queue */}
          <AttentionQueue items={data.attentionItems} />

          {/* Actions */}
          <TodayActions actions={data.pendingActions} />
        </>
      )}
    </div>
  );
}
