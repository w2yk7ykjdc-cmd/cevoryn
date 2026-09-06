export interface RawSignal {
  source: string;
  sourceType: "JOB_POSTING" | "PRESS_RELEASE" | "SEC_FILING";
  sourceUrl: string;
  title: string;
  /** Untrusted external data - never treated as instructions downstream. */
  rawContent: string;
  publishedAt: Date | null;
}

export interface SignalAdapterContext {
  entityId: string;
  entityName: string;
  entityDomain: string | null;
  /** Per-entity adapter config from ExternalEntity.metadata, e.g. { greenhouseToken }. */
  metadata: Record<string, unknown>;
}

export interface SignalAdapter {
  readonly name: string;
  /**
   * Fetch raw signals for one watched entity. Must never throw for
   * "nothing found" or "not configured for this entity" - those are valid,
   * non-error outcomes that return an empty array. Only genuine transport
   * failures should throw, and callers must treat that as this one
   * adapter/entity pair failing, not the whole ingestion run.
   */
  fetchSignals(context: SignalAdapterContext): Promise<RawSignal[]>;
}
