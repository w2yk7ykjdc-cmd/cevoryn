"use server";

import { headers as nextHeaders } from "next/headers";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { createConversation } from "@/server/ai/runtime/conversations";
import { startAgentRun, continueAgentRun, getAgentRun } from "@/server/ai/agent/executor";
import { decideApproval } from "@/server/ai/approval/service";
import type { AgentRunWithSteps } from "@/server/ai/agent/types";

export type AgentActionResult =
  | { success: true; run: AgentRunWithSteps }
  | { success: false; error: string };

/**
 * Starts a fresh AI Sales Employee agent run: creates a conversation for it,
 * plans the goal, and executes the plan until it completes, fails, or pauses
 * for approval. Gated the same way the chat runtime is (`aiConversation:create`)
 * — the real per-action authorization happens per step, inside the Tool
 * Engine and the approval service.
 */
export async function startAgentRunAction(goal: string): Promise<AgentActionResult> {
  const { session, organization } = await requirePermission({ aiConversation: ["create"] });

  const trimmed = goal.trim();
  if (!trimmed) {
    return { success: false, error: "Describe what you'd like the AI Sales Employee to do." };
  }

  try {
    const conversation = await createConversation({
      organizationId: organization.id,
      userId: session.user.id,
      title: trimmed.slice(0, 80),
    });
    const run = await startAgentRun({
      organizationId: organization.id,
      userId: session.user.id,
      conversationId: conversation.id,
      goal: trimmed,
      requestHeaders: await nextHeaders(),
    });
    revalidatePath("/dashboard/agent");
    return { success: true, run };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to start the agent run" };
  }
}

/**
 * Records a human decision on a pending approval, then immediately resumes
 * the run it was blocking. The approval service checks the decider holds
 * the underlying tool's own required permission — a viewer, for instance,
 * cannot approve a `create_task` step just because they can see the run.
 */
export async function decideApprovalAction(
  approvalId: string,
  agentRunId: string,
  decision: "approved" | "rejected",
  decisionNote?: string,
): Promise<AgentActionResult> {
  const { session, organization } = await requirePermission({ aiConversation: ["read"] });

  try {
    await decideApproval({
      approvalId,
      organizationId: organization.id,
      decidedById: session.user.id,
      decision,
      decisionNote,
      requestHeaders: await nextHeaders(),
    });
    const run = await continueAgentRun({
      agentRunId,
      organizationId: organization.id,
      requestHeaders: await nextHeaders(),
    });
    revalidatePath("/dashboard/agent");
    return { success: true, run };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to record the approval decision" };
  }
}

export async function refreshAgentRunAction(agentRunId: string): Promise<AgentActionResult> {
  const { organization } = await requirePermission({ aiConversation: ["read"] });

  try {
    const run = await getAgentRun(agentRunId, organization.id);
    return { success: true, run };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to load the run" };
  }
}
