import "server-only";

import type {
  BrainContextParams,
  BrainExchangeParams,
  BrainModule,
} from "../core/types";
import {
  getLatestPulse,
  refreshDailyPulse,
} from "./pulse.service";

export class PulseModule implements BrainModule {
  readonly name = "pulse";

  async getContext(
    params: BrainContextParams
  ): Promise<string> {
    let snapshot = await getLatestPulse(
      params.organizationId,
      "DAILY"
    );

    if (!snapshot) {
      const metrics = await refreshDailyPulse(
        params.organizationId
      );

      return this.formatContext(
        metrics,
        new Date(),
        new Date()
      );
    }

    return this.formatContext(
      snapshot.metrics,
      snapshot.periodStart,
      snapshot.periodEnd
    );
  }

  async afterExchange(
    _params: BrainExchangeParams
  ): Promise<void> {
    // Pulse is calculated periodically, not after every message.
  }

  private formatContext(
    metrics: unknown,
    periodStart: Date,
    periodEnd: Date
  ): string {
    return [
      "## Current Company Pulse",
      `Period start: ${periodStart.toISOString()}`,
      `Period end: ${periodEnd.toISOString()}`,
      "Use these real company metrics when answering questions about the company's current state.",
      "Do not claim that company information is unavailable when these metrics are present.",
      "Metrics:",
      JSON.stringify(metrics, null, 2),
    ].join("\n");
  }
}