// =============================================================================
// CEVORYN — Shared Types
// =============================================================================

/** Standard API success response */
export interface ApiResponse<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
  };
}

/** Standard API error response */
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export type SortDirection = "asc" | "desc";

export interface SortParams<T extends string = string> {
  sortBy?: T;
  sortDirection?: SortDirection;
}

export type MemberRole = "OWNER" | "ADMIN" | "MEMBER";
export type InviteStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";

export interface AuthUser {
  id: string;
  email: string;
  emailConfirmedAt: string | null;
  createdAt: string;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  memberCount: number;
}

export interface MembershipContext {
  memberId: string;
  userId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: MemberRole;
  displayName: string;
  avatarUrl: string | null;
}

export interface OrganizationMembershipOption {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: MemberRole;
}

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// =============================================================================
// AI Types
// =============================================================================

export type MessageRole = "USER" | "ASSISTANT" | "SYSTEM";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamChunk {
  type: "text" | "error" | "done";
  content?: string;
  messageId?: string;
  usage?: TokenUsage;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ConversationDetail {
  id: string;
  title: string;
  messages: MessageDetail[];
  createdAt: string;
  updatedAt: string;
}

export interface MessageDetail {
  id: string;
  role: MessageRole;
  content: string;
  model: string | null;
  createdAt: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  dailyLimit: number;
  resetAt: Date;
}
