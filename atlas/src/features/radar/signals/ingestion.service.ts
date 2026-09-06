import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { jobsAdapter } from "./adapters/jobs-adapter";
import { rssAdapter } from "./adapters/rss-adapter";
import { secEdgarAdapter } from "./adapters/sec-edgar-adapter";
import type { SignalAdapter } from "./adapters/types";
import { hashSignal } from "./signal-hash";

const ADAPTERS: SignalAdapter[] = [jobsAdapter, rssAdapter, secEdgarAdapter];

export interface EntityIngestionResult {
  entityId: string;
  entityName: string;
  fetched: number;
  created: number;
  adapterErrors: string[];
}

/**
 * Runs every configured adapter for one watched entity and idempotently
 * persists whatever they return. `createMany({ skipDuplicates: true })`
 * against the `(organizationId, hash)` unique constraint is what makes
 * this safe to re-run on a schedule: a re-fetch of the same feed simply
 * inserts zero new rows for items already seen, no read-before-write
 * race condition.
 *
 * One adapter throwing (a real transport failure, not "nothing found")
 * is recorded in adapterErrors and does not stop the other adapters for
 * this entity, or other entities in the batch.
 */
export async function ingestSignalsForEntity(
  organizationId: string,
  entity: {
    id: string;
    name: string;
    domain: string | null;
    metadata: unknown;
  }
): Promise<EntityIngestionResult> {
  const metadata =
    entity.metadata && typeof entity.metadata === "object"
      ? (entity.metadata as Record<string, unknown>)
      : {};

  let fetched = 0;
  let created = 0;
  const adapterErrors: string[] = [];

  for (const adapter of ADAPTERS) {
    try {
      const signals = await adapter.fetchSignals({
        entityId: entity.id,
        entityName: entity.name,
        entityDomain: entity.domain,
        metadata,
      });
      fetched += signals.length;
      if (signals.length === 0) continue;

      const result = await prisma.externalSignal.createMany({
        data: signals.map((signal) => ({
          organizationId,
          externalEntityId: entity.id,
          source: signal.source,
          sourceType: signal.sourceType,
          sourceUrl: signal.sourceUrl,
          title: signal.title,
          rawContent: signal.rawContent,
          publishedAt: signal.publishedAt,
          hash: hashSignal(signal.source, signal.sourceUrl, signal.title),
          metadata: {} as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
      created += result.count;
    } catch (error) {
      adapterErrors.push(
        `${adapter.name}: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  return {
    entityId: entity.id,
    entityName: entity.name,
    fetched,
    created,
    adapterErrors,
  };
}

export async function ingestSignalsForOrganization(
  organizationId: string
): Promise<EntityIngestionResult[]> {
  const entities = await prisma.externalEntity.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, name: true, domain: true, metadata: true },
  });

  const results: EntityIngestionResult[] = [];
  for (const entity of entities) {
    results.push(await ingestSignalsForEntity(organizationId, entity));
  }
  return results;
}
