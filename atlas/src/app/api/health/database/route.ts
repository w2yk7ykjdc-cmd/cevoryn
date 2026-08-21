import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Not tied to any organization (infra/deploy diagnostic, same answer for
 * everyone) so this reuses the CRON_SECRET bearer-token pattern the cron
 * routes use, rather than requiring an org admin session - simpler to
 * check manually after a deploy (curl with the header) and avoids leaking
 * table/migration names and Prisma error codes to anonymous callers, which
 * this endpoint did unconditionally before this check existed.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

interface MigrationStatus {
  /** Migrations Prisma's `_prisma_migrations` table records as finished. */
  appliedCount: number;
  /** Most recently finished migration, by started_at. Null if none. */
  latestApplied: string | null;
  /**
   * Migrations with a row but no `finished_at` - i.e. the exact P3009/P3018
   * "failed migration blocks all future deploys" state this project hit in
   * production once (see scripts/deploy-migrate.mjs). Should always be
   * empty; a non-empty list here means a deploy needs manual attention.
   */
  unfinished: string[];
}

interface DiagnosticResult {
  databaseReachable: boolean;
  schemaReady: boolean;
  tablesFound: string[];
  tablesMissing: string[];
  prismaErrorCode: string | null;
  sanitizedMessage: string;
  migrations: MigrationStatus | null;
}

const REQUIRED_TABLES = ["organizations", "members", "subscriptions"];

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );
  }

  const result: DiagnosticResult = {
    databaseReachable: false,
    schemaReady: false,
    tablesFound: [],
    tablesMissing: [],
    prismaErrorCode: null,
    sanitizedMessage: "",
    migrations: null,
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    result.databaseReachable = true;
  } catch (error) {
    const prismaError = error as { code?: string };
    result.prismaErrorCode = prismaError.code ?? "CONNECTION_FAILED";
    result.sanitizedMessage = "Cannot reach database. Check DATABASE_URL.";
    return NextResponse.json(result, { status: 503 });
  }

  try {
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;

    const tableNames = tables.map((table) => table.tablename);
    result.tablesFound = tableNames;
    result.tablesMissing = REQUIRED_TABLES.filter(
      (table) => !tableNames.includes(table)
    );
    result.schemaReady = result.tablesMissing.length === 0;
    result.sanitizedMessage = result.schemaReady
      ? "Database ready"
      : `Missing tables: ${result.tablesMissing.join(", ")}. Run: npx prisma migrate deploy`;

    // Proof that a deploy actually ran `prisma migrate deploy` against
    // this database, not just `prisma generate` (see scripts/deploy-migrate.mjs) -
    // check this endpoint after a deploy instead of digging through build logs.
    if (tableNames.includes("_prisma_migrations")) {
      const migrations = await prisma.$queryRaw<
        Array<{ migration_name: string; finished_at: Date | null }>
      >`
        SELECT migration_name, finished_at FROM "_prisma_migrations"
        ORDER BY started_at ASC
      `;
      const finished = migrations.filter((m) => m.finished_at !== null);
      result.migrations = {
        appliedCount: finished.length,
        latestApplied: finished.at(-1)?.migration_name ?? null,
        unfinished: migrations
          .filter((m) => m.finished_at === null)
          .map((m) => m.migration_name),
      };
    }
  } catch (error) {
    const prismaError = error as { code?: string };
    result.prismaErrorCode = prismaError.code ?? "QUERY_FAILED";
    result.sanitizedMessage = "Connected but cannot query schema";
  }

  return NextResponse.json(result, {
    status: result.schemaReady ? 200 : 503,
  });
}
