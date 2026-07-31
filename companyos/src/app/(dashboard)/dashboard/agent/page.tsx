import { requirePermission } from "@/server/auth/session";
import { listAgentRuns } from "@/server/ai/agent/executor";
import { listPendingApprovals } from "@/server/ai/approval/service";
import { AgentClient } from "@/app/(dashboard)/dashboard/agent/agent-client";

export default async function AgentPage() {
  const { organization } = await requirePermission({ aiConversation: ["create"] });

  const [runs, pendingApprovals] = await Promise.all([
    listAgentRuns(organization.id),
    listPendingApprovals(organization.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Sales Employee — Agent</h1>
        <p className="text-sm text-muted-foreground">
          Describe a goal in plain language. The agent plans an ordered sequence of tool calls, runs
          each one through the same RBAC-checked Tool Engine as the chat assistant, and pauses for your
          approval before anything risky happens.
        </p>
      </div>
      <AgentClient
        initialRuns={runs.map((run) => ({
          id: run.id,
          goal: run.goal,
          status: run.status,
          resultSummary: run.resultSummary,
          errorMessage: run.errorMessage,
          createdAt: run.createdAt,
        }))}
        initialPendingApprovals={pendingApprovals.map((approval) => ({
          id: approval.id,
          agentRunId: approval.agentRunId,
          toolName: approval.toolName,
          input: approval.input as Record<string, unknown>,
          reason: approval.reason,
          createdAt: approval.createdAt,
        }))}
      />
    </div>
  );
}
