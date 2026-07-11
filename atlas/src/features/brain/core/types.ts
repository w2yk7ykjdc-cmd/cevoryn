import type { MembershipContext } from "@/types";

// =============================================================================
// Brain Module Interface — every brain capability implements this
// =============================================================================

/** Parameters passed to modules during context building */
export interface BrainContextParams {
  organizationId: string;
  userId: string;
  conversationId: string;
  latestMessage: string;
}

/** Parameters passed to modules after each AI exchange */
export interface BrainExchangeParams {
  organizationId: string;
  userId: string;
  conversationId: string;
  userMessage: string;
  assistantMessage: string;
  membership: MembershipContext;
}

/**
 * Contract for all brain modules (Memory, Insights, Pulse, etc.)
 * Follows Interface Segregation — modules implement only what they need.
 */
export interface BrainModule {
  readonly name: string;

  /**
   * Return context to inject into the AI system prompt.
   * Called during every conversation exchange.
   * Return empty string to skip injection.
   */
  getContext(params: BrainContextParams): Promise<string>;

  /**
   * Post-processing hook called after each AI exchange completes.
   * Use for memory extraction, metric updates, etc.
   */
  afterExchange?(params: BrainExchangeParams): Promise<void>;
}

// =============================================================================
// Pulse Metrics (structured JSON stored in PulseSnapshot.metrics)
// =============================================================================

export interface PulseMetrics {
  conversationCount: number;
  messageCount: number;
  activeUserCount: number;
  topTopics: Array<{ topic: string; count: number }>;
  avgResponseTimeMs: number;
  tokenUsage: { input: number; output: number; total: number };
}

// =============================================================================
// Brief Sections (structured JSON stored in Brief.sections)
// =============================================================================

export interface BriefSection {
  heading: string;
  content: string;
  priority: "high" | "medium" | "low";
}

// =============================================================================
// Evidence item for insights
// =============================================================================

export interface EvidenceItem {
  conversationId: string;
  excerpt: string;
  timestamp: string;
}
