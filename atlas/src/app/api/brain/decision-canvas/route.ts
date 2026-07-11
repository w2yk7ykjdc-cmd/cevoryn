import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getMembership, getUser } from "@/lib/auth";
import { generateDecisionCanvas } from "@/features/brain/decisions/decision-canvas";
import { createDecisionSchema } from "@/features/brain/decisions/schemas";
import { hasPermission } from "@/lib/rbac";

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );
  }

  const membership = await getMembership(user.id);
  if (!membership) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "No organization" } },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (_error) {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Invalid body" } },
      { status: 400 }
    );
  }

  if (!hasPermission(membership.role, "ai:use")) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
      { status: 403 }
    );
  }

  const parsed = createDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid input" } },
      { status: 400 }
    );
  }

  const envelope = await generateDecisionCanvas({
    organizationId: membership.organizationId,
    problemDescription: parsed.data.problemDescription,
    evidence: [],
  });

  return NextResponse.json({
    data: {
      canvas: envelope.data,
      trust: {
        confidence: envelope.confidence,
        reasoning: envelope.reasoning,
        missingInformation: envelope.missingInformation,
        dataFreshness: envelope.dataFreshness,
      },
    },
  });
}
