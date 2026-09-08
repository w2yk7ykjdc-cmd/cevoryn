"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { OutcomeEvaluationStatus, OutcomeSource, OutcomeType } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { confirmOutcomeAction } from "@/app/(dashboard)/dashboard/outcomes/actions";

export type OutcomeRow = {
  id: string;
  relatedEntityType: string;
  relatedEntityId: string;
  ruleName: string;
  ruleVersion: string;
  evaluationStatus: OutcomeEvaluationStatus;
  outcomeType: OutcomeType | null;
  source: OutcomeSource | null;
  confidence: number | null;
  createdAt: string;
  observedAt: string | null;
};

const OUTCOME_TYPE_OPTIONS: OutcomeType[] = ["success", "failure", "neutral", "expired", "reversed", "unknown"];

function evaluationStatusBadgeVariant(status: OutcomeEvaluationStatus): "default" | "secondary" | "destructive" {
  if (status === "evaluated") return "default";
  if (status === "insufficient_evidence") return "destructive";
  return "secondary";
}

export function OutcomesClient({ initialOutcomes }: { initialOutcomes: OutcomeRow[] }) {
  const router = useRouter();
  const [outcomes, setOutcomes] = useState(initialOutcomes);
  const [selections, setSelections] = useState<Record<string, OutcomeType>>({});
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function handleConfirm(outcomeId: string) {
    const chosen = selections[outcomeId] ?? "success";
    setConfirmingId(outcomeId);
    const result = await confirmOutcomeAction(outcomeId, chosen);
    setConfirmingId(null);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setOutcomes((prev) =>
      prev.map((o) =>
        o.id === outcomeId
          ? { ...o, evaluationStatus: "evaluated" as const, outcomeType: chosen, source: "human" as const, confidence: 100 }
          : o,
      ),
    );
    toast.success("Outcome confirmed");
    router.refresh();
  }

  if (outcomes.length === 0) {
    return <p className="text-sm text-muted-foreground">No outcomes recorded yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Subject</TableHead>
          <TableHead>Rule</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead>Confidence</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Confirm</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {outcomes.map((outcome) => (
          <TableRow key={outcome.id}>
            <TableCell className="font-mono text-xs">
              {outcome.relatedEntityType}:{outcome.relatedEntityId.slice(0, 8)}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {outcome.ruleName}.{outcome.ruleVersion}
            </TableCell>
            <TableCell>
              <Badge variant={evaluationStatusBadgeVariant(outcome.evaluationStatus)}>{outcome.evaluationStatus}</Badge>
            </TableCell>
            <TableCell>{outcome.outcomeType ?? "—"}</TableCell>
            <TableCell>{outcome.confidence ?? "—"}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{outcome.source ?? "—"}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Select
                  value={selections[outcome.id] ?? "success"}
                  onValueChange={(value) => setSelections((prev) => ({ ...prev, [outcome.id]: value as OutcomeType }))}
                >
                  <SelectTrigger className="h-8 w-[110px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OUTCOME_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={confirmingId === outcome.id}
                  onClick={() => handleConfirm(outcome.id)}
                >
                  {confirmingId === outcome.id ? "Saving…" : "Confirm"}
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
