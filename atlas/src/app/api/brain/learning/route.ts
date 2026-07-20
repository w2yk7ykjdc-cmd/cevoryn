import { NextResponse } from "next/server";

import { computeCalibration } from "@/features/brain/learning/confidence-calibrator";
import {
  extractLearningPatterns,
  getLearningPatterns,
} from "@/features/brain/learning/learning-engine";
import { unauthorizedResponse, forbiddenResponse } from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const [patterns, calibration] = await Promise.all([
      getLearningPatterns(membership.organizationId),
      computeCalibration(membership.organizationId),
    ]);

    return NextResponse.json({
      data: {
        patterns,
        calibration: {
          adjustmentFactor: calibration.adjustmentFactor,
          isCalibrated: calibration.isCalibrated,
          dataPoints: calibration.dataPoints.length,
        },
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    console.error("Learning GET error:", msg);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to load learning data",
        },
      },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const patternsCreated = await extractLearningPatterns(
      membership.organizationId
    );
    return NextResponse.json({ data: { patternsExtracted: patternsCreated } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    console.error("Learning POST error:", msg);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to extract patterns",
        },
      },
      { status: 500 }
    );
  }
}
