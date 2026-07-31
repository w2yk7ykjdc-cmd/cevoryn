"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { AgentApprovalStatus, AgentRunStatus, AgentStepStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  decideApprovalAction,
  refreshAgentRunAction,
  startAgentRunAction,
  type AgentActionResult,
} from "@/app/(dashboard)/dashboard/agent/actions";

type AgentRunDetail = Extract<AgentActionResult, { success: true }>["run"];

type RunSummary = {
  id: string;
  goal: string;
  status: AgentRunStatus;
  resultSummary: string | null;
  errorMessage: string | null;
  createdAt: Date;
};

type PendingApprovalSummary = {
  id: string;
  agentRunId: string;
  toolName: string;
  input: Record<string, unknown>;
  reason: string;
  createdAt: Date;
};

const RUN_STATUS_VARIANT: Record<AgentRunStatus, "outline" | "secondary" | "default" | "destructive"> = {
  planning: "outline",
  running: "secondary",
  waiting_approval: "secondary",
  completed: "default",
  failed: "destructive",
  rejected: "destructive",
};

const STEP_STATUS_VARIANT: Record<AgentStepStatus, "outline" | "secondary" | "default" | "destructive"> = {
  pending: "outline",
  running: "secondary",
  succeeded: "default",
  failed: "destructive",
  skipped: "outline",
};

const APPROVAL_STATUS_VARIANT: Record<AgentApprovalStatus, "outline" | "secondary" | "default" | "destructive"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
};

export function AgentClient({
  initialRuns,
  initialPendingApprovals,
}: {
  initialRuns: RunSummary[];
  initialPendingApprovals: PendingApprovalSummary[];
}) {
  const [goal, setGoal] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentRun, setCurrentRun] = useState<AgentRunDetail | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>(initialRuns);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalSummary[]>(initialPendingApprovals);
  const [decidingApprovalId, setDecidingApprovalId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  function applyRun(run: AgentRunDetail) {
    setCurrentRun(run);
    setRuns((prev) => {
      const summary: RunSummary = {
        id: run.id,
        goal: run.goal,
        status: run.status,
        resultSummary: run.resultSummary,
        errorMessage: run.errorMessage,
        createdAt: run.createdAt,
      };
      const withoutRun = prev.filter((r) => r.id !== run.id);
      return [summary, ...withoutRun];
    });
    setPendingApprovals((prev) => {
      const stillPendingForRun = run.approvals
        .filter((a) => a.status === "pending")
        .map((a) => ({
          id: a.id,
          agentRunId: run.id,
          toolName: a.toolName,
          input: a.input as Record<string, unknown>,
          reason: a.reason,
          createdAt: a.createdAt,
        }));
      const withoutRun = prev.filter((a) => a.agentRunId !== run.id);
      return [...stillPendingForRun, ...withoutRun];
    });
  }

  async function handleStart(event: React.FormEvent) {
    event.preventDefault();
    if (!goal.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const result = await startAgentRunAction(goal);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      applyRun(result.run);
      setGoal("");
      if (result.run.status === "waiting_approval") {
        toast.info("The plan reached a step that needs your approval.");
      } else if (result.run.status === "failed") {
        toast.error(result.run.errorMessage ?? "The agent run failed.");
      } else if (result.run.status === "completed") {
        toast.success("Run completed.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDecide(approval: PendingApprovalSummary, decision: "approved" | "rejected") {
    setDecidingApprovalId(approval.id);
    try {
      const result = await decideApprovalAction(approval.id, approval.agentRunId, decision);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      applyRun(result.run);
      toast.success(decision === "approved" ? "Approved. Resuming the run." : "Rejected. Run resumed without this step.");
    } finally {
      setDecidingApprovalId(null);
    }
  }

  async function handleOpenRun(runId: string) {
    setIsRefreshing(true);
    try {
      const result = await refreshAgentRunAction(runId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setCurrentRun(result.run);
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New goal</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleStart} className="flex flex-col gap-3">
              <Textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder='e.g. "Analyze the Globex lead and follow up appropriately"'
                disabled={isSubmitting}
                rows={3}
              />
              <div>
                <Button type="submit" disabled={isSubmitting || goal.trim().length === 0}>
                  {isSubmitting ? "Planning…" : "Run"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {currentRun && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base">{currentRun.goal}</CardTitle>
              </div>
              <Badge variant={RUN_STATUS_VARIANT[currentRun.status]} className="capitalize">
                {currentRun.status.replace("_", " ")}
              </Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {currentRun.resultSummary && (
                <p className="text-sm text-muted-foreground">{currentRun.resultSummary}</p>
              )}
              {currentRun.errorMessage && (
                <p className="text-sm text-destructive">{currentRun.errorMessage}</p>
              )}

              {currentRun.steps.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  The planner decided no tool calls were needed for this goal.
                </p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {currentRun.steps.map((step) => {
                    const approval = currentRun.approvals.find((a) => a.id === step.approvalId);
                    const pending = pendingApprovals.find((a) => a.id === step.approvalId);
                    return (
                      <li key={step.id} className="rounded-md border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-sm">
                            {step.stepIndex + 1}. {step.toolName}
                          </span>
                          <Badge variant={STEP_STATUS_VARIANT[step.status]} className="capitalize">
                            {step.status}
                          </Badge>
                        </div>
                        <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">
                          {JSON.stringify(step.input, null, 2)}
                        </pre>
                        {step.status === "succeeded" && step.output != null && (
                          <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">
                            {JSON.stringify(step.output, null, 2)}
                          </pre>
                        )}
                        {step.errorMessage && (
                          <p className="mt-2 text-xs text-destructive">{step.errorMessage}</p>
                        )}
                        {approval && (
                          <div className="mt-3 rounded-md border border-dashed p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs text-muted-foreground">{approval.reason}</p>
                              <Badge variant={APPROVAL_STATUS_VARIANT[approval.status]} className="capitalize shrink-0">
                                {approval.status}
                              </Badge>
                            </div>
                            {pending && (
                              <div className="mt-2 flex gap-2">
                                <Button
                                  size="sm"
                                  disabled={decidingApprovalId === pending.id}
                                  onClick={() => handleDecide(pending, "approved")}
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={decidingApprovalId === pending.id}
                                  onClick={() => handleDecide(pending, "rejected")}
                                >
                                  Reject
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-6">
        {pendingApprovals.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Needs your approval</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {pendingApprovals.map((approval) => (
                <div key={approval.id} className="rounded-md border p-3 text-sm">
                  <p className="font-mono text-xs">{approval.toolName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{approval.reason}</p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      disabled={decidingApprovalId === approval.id}
                      onClick={() => handleDecide(approval, "approved")}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={decidingApprovalId === approval.id}
                      onClick={() => handleDecide(approval, "rejected")}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent runs</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {runs.length === 0 && <p className="text-sm text-muted-foreground">No runs yet.</p>}
            {runs.map((run, index) => (
              <div key={run.id}>
                {index > 0 && <Separator className="my-1" />}
                <button
                  type="button"
                  onClick={() => handleOpenRun(run.id)}
                  disabled={isRefreshing}
                  className={cn(
                    "w-full rounded-md p-2 text-left text-sm hover:bg-accent",
                    currentRun?.id === run.id && "bg-accent",
                  )}
                >
                  <p className="truncate font-medium">{run.goal}</p>
                  <Badge variant={RUN_STATUS_VARIANT[run.status]} className="mt-1 capitalize">
                    {run.status.replace("_", " ")}
                  </Badge>
                </button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
