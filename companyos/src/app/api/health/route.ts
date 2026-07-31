import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { redis } from "@/server/redis/client";

export const dynamic = "force-dynamic";

/** Liveness/readiness probe for orchestrators (Docker healthcheck, k8s, load balancers). */
export async function GET() {
  const [dbOk, redisOk] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    redis.ping().then((pong) => pong === "PONG").catch(() => false),
  ]);

  const healthy = dbOk && redisOk;

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks: { database: dbOk, redis: redisOk } },
    { status: healthy ? 200 : 503 },
  );
}
