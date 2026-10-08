import assert from "node:assert/strict";
import test from "node:test";

import { TestAudioStorageProvider } from "../src/features/romance/audio/audio-storage-provider";

test("TestAudioStorageProvider stores uploaded audio and reports it present via has()", async () => {
  const storage = new TestAudioStorageProvider();
  assert.equal(storage.has("event-1/0-voice-v1.mp3"), false);

  const uploaded = await storage.uploadAudio("event-1/0-voice-v1.mp3", "base64data", "mp3");
  assert.equal(uploaded.storagePath, "event-1/0-voice-v1.mp3");
  assert.equal(storage.has("event-1/0-voice-v1.mp3"), true);
});

test("TestAudioStorageProvider returns a deterministic, path-encoded playback URL without calling a network", async () => {
  const storage = new TestAudioStorageProvider();
  await storage.uploadAudio("a/b c.mp3", "data", "mp3");

  const url = await storage.getPlaybackUrl("a/b c.mp3");
  assert.equal(url, "test://romance-audio/a%2Fb%20c.mp3");
});
