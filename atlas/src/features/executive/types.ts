import type { Evidence } from "@/features/brain/trust/types";

/** Page-level state */
export type ExecutiveState = "active" | "quiet" | "insufficient_data";

/** Complete data for the Executive Home — one server fetch, no waterfalls */
export interface ExecutiveHomeData {
  greeting: string;
  dateLabel: string;
  state: ExecutiveState;

  pulse: PulseStatus | null;
  topPriority: TopPriorityItem | null;
  attentionItems: AttentionItem[];
  pendingActions: ActionItem[];

  quietMessage: string;
  insufficientDataReasons: string[];
  resolvedRecently: number;
  memoryCount: number;
}

export interface PulseStatus {
  score: number;
  trend: "improving" | "stable" | "declining";
  statement: string;
}

export interface TopPriorityItem {
  id: string;
  title: string;
  category: string;
  severity: string;
  summary: string;
  description: string;
  impact: string;
  confidence: number;
  reasoning: string;
  recommendedAction: string;
  evidence: Evidence[];
  missingInformation: string[];
}

export interface AttentionItem {
  id: string;
  type: "insight" | "decision";
  title: string;
  summary: string;
  priority: number;
  confidence: number;
  severity: string;
  recommendedAction: string;
}

export interface ActionItem {
  id: string;
  type: string;
  title: string;
  description: string;
  confidence: number;
  reasoning: string;
  sourceInsightId: string | null;
  status: string;
}

/** Analytics event names */
export const ANALYTICS_EVENTS = {
  EXECUTIVE_HOME_VIEWED: "executive_home_viewed",
  TOP_PRIORITY_OPENED: "top_priority_opened",
  EVIDENCE_OPENED: "evidence_opened",
  ATTENTION_ITEM_DISCUSSED: "attention_item_discussed",
  ACTION_APPROVED: "recommended_action_approved",
  ACTION_REJECTED: "recommended_action_rejected",
  MORNING_REVIEW_COMPLETED: "morning_review_completed",
} as const;

export type AnalyticsEventName =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
