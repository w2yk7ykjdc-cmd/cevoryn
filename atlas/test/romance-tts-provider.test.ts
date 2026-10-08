import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateSpeechDurationMs,
  TestTTSProvider,
} from "../src/features/romance/audio/tts-provider";

test("estimateSpeechDurationMs scales with word count at the assumed speech rate", () => {
  const short = estimateSpeechDurationMs("one two three");
  const long = estimateSpeechDurationMs(Array(30).fill("word").join(" "));
  assert.ok(long > short);
  // 30 words at 150 wpm = 12s = 12000ms.
  assert.equal(long, 12_000);
});

test("estimateSpeechDurationMs never returns less than the floor, even for empty/whitespace-only text", () => {
  assert.equal(estimateSpeechDurationMs(""), 500);
  assert.equal(estimateSpeechDurationMs("   "), 500);
});

test("TestTTSProvider is deterministic for the same input and ignores the voice id", async () => {
  const provider = new TestTTSProvider();
  const a = await provider.synthesizeSpeech("hello there", "voice-a");
  const b = await provider.synthesizeSpeech("hello there", "voice-b");

  assert.equal(a.audioBase64, b.audioBase64);
  assert.equal(a.format, "mp3");
  assert.equal(a.approximateDurationMs, estimateSpeechDurationMs("hello there"));
});

test("TestTTSProvider output differs for different text (never a constant fake)", async () => {
  const provider = new TestTTSProvider();
  const a = await provider.synthesizeSpeech("first line", "voice-a");
  const b = await provider.synthesizeSpeech("second line", "voice-a");
  assert.notEqual(a.audioBase64, b.audioBase64);
});
