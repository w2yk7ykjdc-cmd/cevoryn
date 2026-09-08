import { generateMarketStrategies } from "@/server/intelligence/strategy/generate";

export async function generateMarketStrategiesProcessor(): Promise<void> {
  await generateMarketStrategies();
}
