import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

type AIUsageContext = {
  organizationId: string;
  userId: string;
};

const usageContextStorage = new AsyncLocalStorage<AIUsageContext>();

export function runWithAIUsageContext<T>(
  context: AIUsageContext,
  operation: () => Promise<T>
): Promise<T> {
  return usageContextStorage.run(context, operation);
}

export function getAIUsageContext(): AIUsageContext | undefined {
  return usageContextStorage.getStore();
}
