import type { z } from "zod";
import type { AutonomousActionTrigger } from "@prisma/client";
import type { statement } from "@/server/auth/permissions";

export type ToolContext = {
  organizationId: string;
  userId: string;
  conversationId: string;
  /** Where this call originated, for `AutonomousActionLog`. Defaults to `"interactive_chat"` when omitted. */
  triggeredBy?: AutonomousActionTrigger;
  /**
   * Present when this call is one step of an existing `AgentRun` (set by
   * `src/server/ai/agent/executor.ts`) — lets `executeToolCall` attach a
   * newly-needed `AgentApproval` to the EXISTING run/step rather than
   * creating an implicit new one, if its own autonomy gate ever disagrees
   * with the agent executor's own pre-check.
   */
  agentRunId?: string;
  agentStepId?: string;
  /**
   * Set only when resuming a step whose `AgentApproval` is already
   * `"approved"` — lets `executeToolCall` skip re-running
   * `resolveAutonomyDecision` for a call a human has already authorized,
   * rather than looping back into `requires_approval` a second time.
   */
  preApprovedApprovalId?: string;
};

export type RequiredPermission = {
  [K in keyof typeof statement]?: (typeof statement)[K][number][];
};

/**
 * A tool's mutation shape, for autonomy-policy resolution
 * (`src/server/ai/autonomy/resolve.ts`) — deliberately a static, code-owned
 * classification, never influenced by a database policy row:
 * - `read_only`: never touches `AutonomyPolicy` at all; governed by RBAC only.
 * - `auto_append`: a write, but additive/append-only with no destructive or
 *   human-facing consequence (e.g. `record_lead_activity`) — auto-executes
 *   from `AutonomyLevel.L2` upward, same as today's real behavior.
 * - `mutating_gated`: routes through the existing `AgentApproval` queue
 *   unless explicitly allowlisted for unattended execution at L4/L5.
 *
 * A tool with no `mutationCategory` at all is treated as `mutating_gated`
 * with `blastRadius: "destructive"` and `autonomyEligible: false` — the
 * fail-closed default for anything not explicitly classified.
 */
export type ToolMutationCategory = "read_only" | "auto_append" | "mutating_gated";

/**
 * Only meaningful for `mutationCategory: "mutating_gated"`. `"additive"`
 * (creates new records, never deletes/modifies existing ones) is permitted
 * into the approval queue at `AutonomyLevel.L2`; `"destructive"` (deletes or
 * modifies existing data) requires `L3`. Both still always require a human
 * decision via `AgentApproval` — this only controls which tools are allowed
 * to reach that queue at all, not whether the queue itself can be skipped.
 */
export type ToolBlastRadius = "additive" | "destructive";

export type RegisteredTool<TInput = unknown> = {
  name: string;
  description: string;
  schema: z.ZodType<TInput>;
  /** RBAC permission the caller's org membership must hold to invoke this tool. */
  requiredPermission?: RequiredPermission;
  /** Which `AutonomyPolicy` scope this tool belongs to. Defaults to `"crm"` when omitted. */
  domain?: string;
  /** See `ToolMutationCategory`. Defaults to `"mutating_gated"` (fail closed) when omitted. */
  mutationCategory?: ToolMutationCategory;
  /** See `ToolBlastRadius`. Defaults to `"destructive"` (fail closed) when omitted. */
  blastRadius?: ToolBlastRadius;
  /**
   * Whether this tool can EVER run unattended at `AutonomyLevel.L4`/`L5`,
   * regardless of an organization's `AutonomyAllowlistEntry`. Defaults to
   * `false` — a developer must deliberately opt a tool into autonomous
   * eligibility; no organization-level policy can make an unopted-in tool
   * autonomous.
   */
  autonomyEligible?: boolean;
  handler: (input: TInput, ctx: ToolContext) => Promise<unknown>;
};

export type ToolExecutionResult =
  | { status: "success"; output: unknown; durationMs: number }
  | { status: "error"; error: string; durationMs: number }
  | { status: "pending_approval"; approvalId: string; agentRunId: string; durationMs: number };
