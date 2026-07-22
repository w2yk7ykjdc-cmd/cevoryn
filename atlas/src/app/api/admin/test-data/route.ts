import { NextResponse } from "next/server";
import { z } from "zod";

import {
  badRequestResponse,
  forbiddenResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const cleanupSchema = z.object({
  confirmation: z.literal("DELETE TEST DATA"),
});

const TEST_PREFIXES = ["[TEST]", "TEST:", "TEST "];

function testTitleWhere() {
  return {
    OR: TEST_PREFIXES.map((prefix) => ({
      title: { startsWith: prefix, mode: "insensitive" as const },
    })),
  };
}

export async function DELETE(request: Request) {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();
    if (membership.role !== "OWNER") {
      return forbiddenResponse("Only the workspace owner can remove test data");
    }

    const body = await request.json().catch(() => null);
    const parsed = cleanupSchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse("Type DELETE TEST DATA to confirm");
    }

    const organizationId = membership.organizationId;
    const insightWhere = { organizationId, ...testTitleWhere() };
    const testInsights = await prisma.insight.findMany({
      where: insightWhere,
      select: { id: true },
    });
    const insightIds = testInsights.map((item) => item.id);

    const result = await prisma.$transaction(async (tx) => {
      const actions = await tx.preparedAction.deleteMany({
        where: {
          organizationId,
          OR: [
            ...TEST_PREFIXES.map((prefix) => ({
              title: { startsWith: prefix, mode: "insensitive" as const },
            })),
            ...(insightIds.length > 0 ? [{ sourceInsightId: { in: insightIds } }] : []),
          ],
        },
      });
      const insights = await tx.insight.deleteMany({ where: insightWhere });
      return { actions: actions.count, insights: insights.count };
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("Test data cleanup error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Test data cleanup failed" } },
      { status: 500 }
    );
  }
}
