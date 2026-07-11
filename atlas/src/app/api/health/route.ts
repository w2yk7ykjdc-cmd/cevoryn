import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

interface HealthResponse {
  status: "ok" | "degraded" | "error";
  timestamp: string;
  version: string;
  services: {
    database: "connected" | "disconnected";
  };
}

export async function GET() {
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
    version: "0.3.0",
    services: {
      database: dbStatus,
    },
  };

  return NextResponse.json(health, {
    status: health.status === "ok" ? 200 : 503,
  });
}
