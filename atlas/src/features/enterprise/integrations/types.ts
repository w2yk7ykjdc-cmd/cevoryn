/**
 * Proprietary Data / Custom Integrations foundation (Phase 2, section 16;
 * chosen as the Step 5 enterprise foundation).
 *
 * Status: PARTIALLY real as of Step 5. `ProprietaryDataSourceKind` is now
 * the actual Prisma enum backing a real, organization-scoped table
 * (`ProprietaryDataRecord`, prisma/schema.prisma) - see
 * src/features/enterprise/proprietary-data/proprietary-data.service.ts for
 * the real create/list/update/delete/search operations, wired into both a
 * settings UI and the live chat system prompt via
 * src/features/brain/proprietary-data/proprietary-data.module.ts. Every
 * record today is added manually by a user through that UI.
 *
 * `ProprietaryDataProvider` and `CustomIntegrationConfig` below remain
 * interface-only: nothing in the running app constructs one, because there
 * is no real customer CRM/ERP/internal-API connection to fetch from yet,
 * and building a fake one would violate the "no fake production
 * implementation" rule. They exist so that when a real automated
 * integration (e.g. a customer's Salesforce instance, a document store, an
 * internal REST API) is built, it has a contract to implement - and can
 * write into the same `ProprietaryDataRecord` table and pipeline the
 * manual path already uses, rather than inventing a parallel one.
 */

import type { ProprietaryDataSourceKind } from "@prisma/client";

export type { ProprietaryDataSourceKind };

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
