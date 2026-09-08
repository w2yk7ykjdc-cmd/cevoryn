import { scanCompanySignals } from "@/server/intelligence/signals/scanner";

export async function scanCompanySignalsProcessor(): Promise<void> {
  await scanCompanySignals();
}
