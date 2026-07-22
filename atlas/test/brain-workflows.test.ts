import assert from "node:assert/strict";
import test from "node:test";

import { updateActionStatusSchema } from "../src/features/brain/actions/schemas";
import {
  createDecisionSchema,
  updateDecisionStatusSchema,
} from "../src/features/brain/decisions/schemas";

test("decision creation rejects vague problem descriptions", () => {
  const result = createDecisionSchema.safeParse({ problemDescription: "Too short" });
  assert.equal(result.success, false);
});

test("decision creation trims and accepts a concrete problem", () => {
  const result = createDecisionSchema.safeParse({
    problemDescription: "  Decide whether to delay the product launch by one week.  ",
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(
      result.data.problemDescription,
      "Decide whether to delay the product launch by one week."
    );
  }
});

test("completed decisions require an outcome", () => {
  const result = updateDecisionStatusSchema.safeParse({ status: "COMPLETED" });
  assert.equal(result.success, false);
});

test("completed decisions accept a recorded outcome", () => {
  const result = updateDecisionStatusSchema.safeParse({
    status: "COMPLETED",
    outcome: "Launch moved by one week and onboarding errors fell by 30%.",
  });
  assert.equal(result.success, true);
});

test("non-completed decisions do not require an outcome", () => {
  for (const status of ["ACCEPTED", "REJECTED", "IGNORED"] as const) {
    const result = updateDecisionStatusSchema.safeParse({ status });
    assert.equal(result.success, true);
  }
});

test("prepared actions only allow approval or dismissal", () => {
  assert.equal(
    updateActionStatusSchema.safeParse({ status: "APPROVED" }).success,
    true
  );
  assert.equal(
    updateActionStatusSchema.safeParse({ status: "DISMISSED" }).success,
    true
  );
  assert.equal(
    updateActionStatusSchema.safeParse({ status: "PENDING" }).success,
    false
  );
});
