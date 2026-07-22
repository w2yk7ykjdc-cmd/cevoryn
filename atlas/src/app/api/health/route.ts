import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

interface HealthResponse {
  status: "ok" | "degraded" | "error";
  timestamp: string;
  version: string;
  commit: string | null;
  responseTimeMs: number;
  services: {
    database: "connected" | "disconnected";
  };
}

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  let dbStatus: "connected" | "disconnected" = "disconnected";

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = "connected";
  } catch (_error) {
    dbStatus = "disconnected";
  }

  const health: HealthResponse = {
    status: dbStatus === "connected" ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? "unknown",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
    responseTimeMs: Date.now() - startedAt,
    services: {
      database: dbStatus,
    },
  };

  return NextResponse.json(health, {
    status: health.status === "ok" ? 200 : 503,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
