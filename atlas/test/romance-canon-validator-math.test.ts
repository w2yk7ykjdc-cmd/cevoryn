import assert from "node:assert/strict";
import test from "node:test";

import { validateSceneClaims } from "../src/features/romance/engine/canon-validator-math";
import type { CanonContext } from "../src/features/romance/engine/types";

function emptyContext(): CanonContext {
  return {
    trueNameRevealedTo: new Set(),
    knownBargainIds: new Set(),
    knownPromiseIds: new Set(),
    adultCharacterSlugs: new Set(),
  };
}

test("the brief's own worked example: Caelan claiming to know an unrevealed true name is INVALID (CANON-001)", () => {
  const result = validateSceneClaims(
    [{ type: "CHARACTER_KNOWS_TRUE_NAME", characterSlug: "caelan" }],
    emptyContext()
  );

  assert.equal(result.valid, false);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0]?.ruleId, "CANON-001");
});

test("Caelan claiming to know the true name IS valid once a CanonFact records the reveal", () => {
  const context = emptyContext();
  context.trueNameRevealedTo.add("caelan");

  const result = validateSceneClaims(
    [{ type: "CHARACTER_KNOWS_TRUE_NAME", characterSlug: "caelan" }],
    context
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.violations, []);
});

test("revealing the name to a different character does not validate a claim about Caelan", () => {
  const context = emptyContext();
  context.trueNameRevealedTo.add("rival");

  const result = validateSceneClaims(
    [{ type: "CHARACTER_KNOWS_TRUE_NAME", characterSlug: "caelan" }],
    context
  );

  assert.equal(result.valid, false);
});

test("a reference to a bargain that was never proposed in this session is INVALID (CANON-004)", () => {
  const result = validateSceneClaims(
    [
      {
        type: "CHARACTER_CLAIMS_BARGAIN_FULFILLED_WITHOUT_CONSEQUENCE",
        characterSlug: "caelan",
        referenceId: "bargain-that-never-existed",
      },
    ],
    emptyContext()
  );
  assert.equal(result.valid, false);
  assert.equal(result.violations[0]?.ruleId, "CANON-004");
});

test("a reference to a promise that was never made in this session is INVALID (CANON-005)", () => {
  const result = validateSceneClaims(
    [
      {
        type: "CHARACTER_REFERENCES_UNMADE_PROMISE",
        characterSlug: "caelan",
        referenceId: "promise-that-never-existed",
      },
    ],
    emptyContext()
  );
  assert.equal(result.valid, false);
  assert.equal(result.violations[0]?.ruleId, "CANON-005");
});

test("a scene with multiple claims collects every violation, not just the first", () => {
  const result = validateSceneClaims(
    [
      { type: "CHARACTER_KNOWS_TRUE_NAME", characterSlug: "caelan" },
      {
        type: "CHARACTER_REFERENCES_UNMADE_PROMISE",
        characterSlug: "rival",
        referenceId: "missing",
      },
    ],
    emptyContext()
  );
  assert.equal(result.valid, false);
  assert.equal(result.violations.length, 2);
});

test("sexual content involving a character not on record as an adult is INVALID (CANON-006)", () => {
  const result = validateSceneClaims(
    [{ type: "CHARACTER_INVOLVED_IN_SEXUAL_CONTENT", characterSlug: "unverified-character" }],
    emptyContext()
  );
  assert.equal(result.valid, false);
  assert.equal(result.violations[0]?.ruleId, "CANON-006");
});

test("sexual content involving a character on record as an adult IS valid", () => {
  const context = emptyContext();
  context.adultCharacterSlugs.add("caelan");

  const result = validateSceneClaims(
    [{ type: "CHARACTER_INVOLVED_IN_SEXUAL_CONTENT", characterSlug: "caelan" }],
    context
  );
  assert.equal(result.valid, true);
  assert.deepEqual(result.violations, []);
});

test("a scene with zero claims is trivially valid", () => {
  assert.deepEqual(validateSceneClaims([], emptyContext()), {
    valid: true,
    violations: [],
  });
});


test("an unknown runtime scene-claim type fails closed (CANON-007)", () => {
  const unknownClaim = {
    type: "UNRECOGNIZED_SAFETY_CLAIM",
    characterSlug: "caelan",
  } as unknown as import("../src/features/romance/engine/types").SceneClaim;

  const result = validateSceneClaims([unknownClaim], emptyContext());

  assert.equal(result.valid, false);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0]?.ruleId, "CANON-007");
});
