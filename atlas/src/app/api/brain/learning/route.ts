import { NextResponse } from "next/server";

import {
  computeCalibration,
  computeOpportunityCalibration,
} from "@/features/brain/learning/confidence-calibrator";
import {
  extractLearningPatterns,
  getLearningPatterns,
} from "@/features/brain/learning/learning-engine";
import {
  unauthorizedResponse,
  forbiddenResponse,
  internalErrorResponse,
} from "@/lib/api-utils";
import { getMembership, getUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return unauthorizedResponse();

    const membership = await getMembership(user.id);
    if (!membership) return forbiddenResponse();

    const [patterns, calibration, opportunityCalibration] = await Promise.all([
      getLearningPatterns(membership.organizationId),
      computeCalibration(membership.organizationId),
      computeOpportunityCalibration(membership.organizationId),
    ]);

    return NextResponse.json({
      data: {
        patterns,
        calibration: {
          adjustmentFactor: calibration.adjustmentFactor,
          isCalibrated: calibration.isCalibrated,
          dataPoints: calibration.dataPoints.length,
        },
        // Opportunity-sourced calibration - a structurally distinct metric
        // from `calibration` above (Decision-only, see
        // confidence-calibrator.ts::computeOpportunityCalibration's own doc
        // comment). Returned separately, never merged with the Decision
        // figures.
        opportunityCalibration: {
          adjustmentFactor: opportunityCalibration.adjustmentFactor,
          isCalibrated: opportunityCalibration.isCalibrated,
          dataPoints: opportunityCalibration.dataPoints.length,
        },
      },
    });
  } catch (error) {
    return internalErrorResponse(
      "Learning GET",
      error,
      "Failed to load learning data"
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
    return internalErrorResponse(
      "Learning POST",
      error,
      "Failed to extract patterns"
    );
  }
}
