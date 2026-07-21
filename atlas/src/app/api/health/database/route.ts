import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

interface DiagnosticResult {
  databaseReachable: boolean;
  schemaReady: boolean;
  tablesFound: string[];
  tablesMissing: string[];
  prismaErrorCode: string | null;
  sanitizedMessage: string;
}

const REQUIRED_TABLES = ["organizations", "members"];

export async function GET() {
  const result: DiagnosticResult = {
    databaseReachable: false,
    schemaReady: false,
    tablesFound: [],
    tablesMissing: [],
    prismaErrorCode: null,
    sanitizedMessage: "",
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
  } catch (error) {
    const prismaError = error as { code?: string };
    result.prismaErrorCode = prismaError.code ?? "QUERY_FAILED";
    result.sanitizedMessage = "Connected but cannot query schema";
  }

  return NextResponse.json(result, {
    status: result.schemaReady ? 200 : 503,
  });
}
