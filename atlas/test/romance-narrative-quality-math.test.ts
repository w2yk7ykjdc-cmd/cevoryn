import assert from "node:assert/strict";
import test from "node:test";

import { evaluateNarrativeQuality } from "../src/features/romance/engine/narrative-quality-math";

test("a scene whose dialogue adds new information passes cleanly", () => {
  const issues = evaluateNarrativeQuality({
    narration:
      "Caelan sets down his glass and studies you across the firelight.",
    dialogueLines: [
      {
        speakerSlug: "caelan",
        text: "You want to know what the Hunt took from me. Ask properly, and I may answer.",
      },
    ],
  });
  assert.deepEqual(issues, []);
});

test("dialogue that restates the narration in different words is flagged as repetitive", () => {
  const issues = evaluateNarrativeQuality({
    narration:
      "Caelan hesitates, his gaze wavering as he processes your request, clearly uncertain whether to answer honestly.",
    dialogueLines: [
      {
        speakerSlug: "caelan",
        text: "I hesitate, uncertain whether I should answer your request honestly, my gaze wavering as I process this.",
      },
    ],
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.code, "REPETITIVE_DIALOGUE");
});

test("two characters' dialogue lines that repeat the same content are flagged", () => {
  const issues = evaluateNarrativeQuality({
    narration: "The court falls silent.",
    dialogueLines: [
      {
        speakerSlug: "caelan",
        text: "The Wild Hunt will not forgive a debt left unpaid for long.",
      },
      {
        speakerSlug: "rival",
        text: "A debt left unpaid for long, the Wild Hunt will never forgive that.",
      },
    ],
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.code, "REPETITIVE_DIALOGUE");
});

test("short acknowledgment lines ('...', 'Yes.') are never flagged as repetitive, even if they overlap narration", () => {
  const issues = evaluateNarrativeQuality({
    narration: "Caelan nods once, slowly.",
    dialogueLines: [{ speakerSlug: "caelan", text: "..." }],
  });
  assert.deepEqual(issues, []);
});

test("narration with no dialogue and almost no words is flagged as empty progression", () => {
  const issues = evaluateNarrativeQuality({
    narration: "Nothing happens.",
    dialogueLines: [],
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.code, "EMPTY_NARRATION");
});

test("short narration is fine as long as dialogue carries the scene", () => {
  const issues = evaluateNarrativeQuality({
    narration: "Silence.",
    dialogueLines: [
      {
        speakerSlug: "caelan",
        text: "Ask me again, and I will not be so generous with an answer.",
      },
    ],
  });
  assert.deepEqual(issues, []);
});
