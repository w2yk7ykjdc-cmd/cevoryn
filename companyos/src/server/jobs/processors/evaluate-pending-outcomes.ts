import { evaluatePendingOutcomes } from "@/server/intelligence/evaluate-outcomes";

export async function evaluatePendingOutcomesProcessor(): Promise<void> {
  await evaluatePendingOutcomes();
}
