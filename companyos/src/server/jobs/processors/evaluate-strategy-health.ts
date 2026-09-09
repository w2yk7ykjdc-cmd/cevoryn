import { evaluateStrategyHealthForAllOrganizations } from "@/server/intelligence/learning/evaluate-strategy-health";

export async function evaluateStrategyHealthProcessor(): Promise<void> {
  await evaluateStrategyHealthForAllOrganizations();
}
