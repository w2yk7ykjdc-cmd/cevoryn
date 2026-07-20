import "server-only";

import type {
  BrainContextParams,
  BrainExchangeParams,
  BrainModule,
} from "./types";

/**
 * Registry that manages all brain modules.
 * Singleton — modules register at startup, execute in order.
 *
 * Open/Closed: add new modules without touching this class.
 */
class ModuleRegistry {
  private modules: Map<string, BrainModule> = new Map();

  register(module: BrainModule): void {
    if (this.modules.has(module.name)) {
      console.warn(`Brain module "${module.name}" is already registered`);
      return;
    }
    this.modules.set(module.name, module);
  }

  unregister(name: string): void {
    this.modules.delete(name);
  }

  /**
   * Gather context from all registered modules.
   * Each module returns a string (or empty) to inject into the system prompt.
   */
  async gatherContext(params: BrainContextParams): Promise<string[]> {
    const contexts: string[] = [];

    for (const module of this.modules.values()) {
      try {
        const ctx = await module.getContext(params);
        if (ctx.length > 0) {
          contexts.push(ctx);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "unknown";
        console.error(`Brain module "${module.name}" context error: ${msg}`);
      }
    }

    return contexts;
  }

  /**
   * Notify all modules after a conversation exchange.
   * Errors in one module don't block others.
   */
  async notifyExchange(params: BrainExchangeParams): Promise<void> {
    const promises = Array.from(this.modules.values())
      .filter((m) => m.afterExchange !== undefined)
      .map(async (m) => {
        try {
          await m.afterExchange!(params);
        } catch (error) {
          const msg = error instanceof Error ? error.message : "unknown";
          console.error(`Brain module "${m.name}" afterExchange error: ${msg}`);
        }
      });

    await Promise.allSettled(promises);
  }

  getModuleNames(): string[] {
    return Array.from(this.modules.keys());
  }
}

// Singleton instance
const globalForRegistry = globalThis as unknown as {
  brainRegistry: ModuleRegistry | undefined;
};

export const brainRegistry =
  globalForRegistry.brainRegistry ?? new ModuleRegistry();

if (process.env.NODE_ENV !== "production") {
  globalForRegistry.brainRegistry = brainRegistry;
}
