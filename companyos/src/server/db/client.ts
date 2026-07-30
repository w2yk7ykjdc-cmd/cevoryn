import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

/**
 * Process-wide Prisma singleton. Reused across hot reloads in dev so we don't
 * exhaust the connection pool on every file save. Always import this — never
 * instantiate `new PrismaClient()` elsewhere.
 */
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
