import assert from "node:assert/strict";
import test from "node:test";

import {
  getHistoryVisibility,
  matchesInsightFilter,
  readHistoryFilter,
  readInsightFilter,
} from "../src/features/brain/intelligence/filtering";

test("reads supported insight filters safely", () => {
  assert.equal(readInsightFilter("open"), "open");
  assert.equal(readInsightFilter("critical"), "critical");
  assert.equal(readInsightFilter("unexpected"), "all");
});

test("filters insights by status and severity", () => {
  const insight = { status: "NEW", severity: "CRITICAL" };
  assert.equal(matchesInsightFilter(insight, "all"), true);
  assert.equal(matchesInsightFilter(insight, "open"), true);
  assert.equal(matchesInsightFilter(insight, "critical"), true);
  assert.equal(
    matchesInsightFilter({ status: "DISMISSED", severity: "INFO" }, "open"),
    false
  );
});

test("returns safe history visibility", () => {
  assert.deepEqual(getHistoryVisibility(readHistoryFilter("all")), {
    showDecisions: true,
    showActions: true,
  });
  assert.deepEqual(getHistoryVisibility(readHistoryFilter("decisions")), {
    showDecisions: true,
    showActions: false,
  });
  assert.deepEqual(getHistoryVisibility(readHistoryFilter("actions")), {
    showDecisions: false,
    showActions: true,
  });
});
