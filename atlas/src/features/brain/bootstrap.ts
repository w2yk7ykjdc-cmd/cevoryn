import "server-only";

import { brainRegistry } from "./core/module-registry";
import { MemoryModule } from "./memory/memory.module";

/**
 * Initialize the Atlas Brain.
 * Call once at app startup (e.g. in a layout or instrumentation file).
 *
 * Each module registers itself with the registry.
 * The registry is then used by the Atlas Engine during conversations.
 *
 * Add new modules here as they're built:
 * - InsightModule (periodic, not per-message)
 * - PulseModule (periodic, not per-message)
 */
let initialized = false;

export function initializeBrain(): void {
  if (initialized) return;

  brainRegistry.register(new MemoryModule());

  // Future modules:
  // brainRegistry.register(new TaskModule());
  // brainRegistry.register(new CalendarModule());

  initialized = true;
}
