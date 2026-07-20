import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { generateDecisionCanvas } from "@/features/brain/decisions/decision-canvas";
import { createDecisionSchema } from "@/features/brain/decisions/schemas";
import {
  badRequestResponse,
  forbiddenResponse,
  rateLimitedResponse,
  unauthorizedResponse,
  validationErrorResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { checkRateLimit } from "@/server/services/rate-limit.service";

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const membership = await getMembership(user.id);
  if (!membership) {
    return forbiddenResponse();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (_error) {
    return badRequestResponse("Invalid body");
  }

  if (!hasPermission(membership.role, "ai:use")) {
    return forbiddenResponse("Insufficient permissions");
  }

  const parsed = createDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error.flatten().fieldErrors);
  }

  const rateLimit = await checkRateLimit(membership.organizationId);
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit.resetAt);

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
