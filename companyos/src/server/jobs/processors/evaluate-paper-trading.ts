import { evaluatePaperTrading } from "@/server/intelligence/paper-trading/generate";

export async function evaluatePaperTradingProcessor(): Promise<void> {
  await evaluatePaperTrading();
}
