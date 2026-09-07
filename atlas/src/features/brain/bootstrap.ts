import "server-only";

import { brainRegistry } from "./core/module-registry";
import { MemoryModule } from "./memory/memory.module";
import { ProprietaryDataModule } from "./proprietary-data/proprietary-data.module";

/**
 * Initialize the CEVORYN Brain.
 * Call once at app startup (e.g. in a layout or instrumentation file).
 *
 * Only modules that provide non-conflicting conversational context belong here.
 * Pulse remains available to dashboards and scheduled jobs, but chat status
 * answers use the fresh telemetry assembled in the AI context builder.
 */
let initialized = false;

export function initializeBrain(): void {
  if (initialized) return;

  brainRegistry.register(new MemoryModule());
  brainRegistry.register(new ProprietaryDataModule());

  initialized = true;
}
