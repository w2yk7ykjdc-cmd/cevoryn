import { rolloverExpiredPeriods } from "@/server/billing/rollover";
import { logger } from "@/server/logger/logger";

export async function rollBillingPeriodsProcessor(): Promise<void> {
  const rolled = await rolloverExpiredPeriods();
  if (rolled > 0) {
    logger.info({ rolled }, "rolled over expired free-tier billing periods");
  }
}
