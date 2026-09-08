import { ingestMarketData } from "@/server/intelligence/signals/market-scanner";

export async function ingestMarketDataProcessor(): Promise<void> {
  await ingestMarketData();
}
