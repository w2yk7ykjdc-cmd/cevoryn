export interface RawSignal {
  source: string;
  sourceType: "JOB_POSTING" | "PRESS_RELEASE" | "SEC_FILING" | "NEWS_ARTICLE";
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
  entityIndustry: string | null;
  entityCountry: string | null;
  /** Per-entity adapter config from ExternalEntity.metadata, e.g. { greenhouseToken }. */
  metadata: Record<string, unknown>;
}

export interface SignalAdapter {
  readonly name: string;
  fetchSignals(context: SignalAdapterContext): Promise<RawSignal[]>;
}
