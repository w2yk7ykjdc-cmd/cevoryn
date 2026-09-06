/**
 * Proprietary Data / Custom Integrations foundation (Phase 2, section 16).
 *
 * Status: interface only. No implementation exists yet, and nothing in the
 * running app constructs a value of this type - there is no real customer
 * document store, CRM, ERP, or internal API to integrate with today, and
 * building a fake one would violate the "no fake production implementation"
 * rule. This type exists so that when a real integration (e.g. a customer's
 * Salesforce instance, a document store, an internal REST API) is actually
 * built, it has a contract to implement rather than inventing an ad hoc
 * shape per integration - and so Radar's ingestion/context-building code
 * can eventually accept `ProprietaryDataProvider[]` alongside its existing
 * RSS/SEC/Greenhouse adapters without a breaking change.
 */

export type ProprietaryDataSourceKind =
  "DOCUMENT_STORE" | "CRM" | "ERP" | "INTERNAL_API" | "KNOWLEDGE_BASE";

export interface ProprietaryDataRecord {
  id: string;
  sourceKind: ProprietaryDataSourceKind;
  title: string;
  content: string;
  url: string | null;
  updatedAt: Date;
}

/**
 * One organization's connection to one external, org-owned data source.
 * Mirrors the shape of the existing Radar signal adapters
 * (src/features/radar/signals/adapters/*) deliberately: fetch(), scoped by
 * organizationId, returns plain records for the caller to persist/ingest -
 * so a real implementation can be dropped into the same pipeline machinery
 * (retry, SSRF guard, PipelineRun observability) that adapters already use.
 */
export interface ProprietaryDataProvider {
  readonly sourceKind: ProprietaryDataSourceKind;
  readonly providerId: string;
  fetchRecords(organizationId: string): Promise<ProprietaryDataRecord[]>;
}

/**
 * A named, organization-configured connection to a third-party system
 * (e.g. "acme-corp-salesforce"). Distinct from ProprietaryDataProvider:
 * this is the *configuration* (what would be stored per-organization),
 * that provider is the *code* that knows how to talk to one kind of system.
 */
export interface CustomIntegrationConfig {
  id: string;
  organizationId: string;
  providerId: string;
  displayName: string;
  isEnabled: boolean;
  /** Provider-specific connection settings. Never log this - may contain credentials. */
  config: Record<string, unknown>;
}
