/**
 * Text-to-speech provider abstraction (brief §26: "create interfaces
 * (e.g. LLMProvider, TTSProvider, AudioRenderer); providers must be
 * swappable"). No Prisma, no "server-only" - the deterministic
 * TestTTSProvider lives here so it stays importable from plain unit
 * tests (same reasoning as scene-generation-provider.ts). The real
 * OpenAI-backed implementation lives in ./openai-tts-provider.ts, which
 * does need "server-only".
 */

export interface SynthesizedSpeech {
  audioBase64: string;
  format: "mp3";
  /** Best-effort estimate - the real provider does not return exact duration, so this is approximate (used for AudioAsset.durationMs, a display/seek hint, not a correctness-critical value). */
  approximateDurationMs: number;
}

export interface TTSProvider {
  readonly name: string;
  synthesizeSpeech(text: string, providerVoiceId: string): Promise<SynthesizedSpeech>;
}

const WORDS_PER_MINUTE_SPEECH_ESTIMATE = 150;

export function estimateSpeechDurationMs(text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const minutes = wordCount / WORDS_PER_MINUTE_SPEECH_ESTIMATE;
  return Math.max(500, Math.round(minutes * 60_000));
}

/**
 * Deterministic test double - never calls a real network. Produces a
 * tiny, valid (silent) base64 MP3-shaped payload so callers that decode
 * or store it don't need special-casing for tests.
 */
export class TestTTSProvider implements TTSProvider {
  readonly name = "test-tts-provider";

  async synthesizeSpeech(text: string, providerVoiceId: string): Promise<SynthesizedSpeech> {
    void providerVoiceId;
    return {
      audioBase64: Buffer.from(`fake-audio:${text}`).toString("base64"),
      format: "mp3",
      approximateDurationMs: estimateSpeechDurationMs(text),
    };
  }
}
