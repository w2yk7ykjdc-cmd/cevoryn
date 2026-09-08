import { generateMarketIntelligence } from "@/server/intelligence/market-intelligence/generate";

export async function generateMarketIntelligenceProcessor(): Promise<void> {
  await generateMarketIntelligence();
}
