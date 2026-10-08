import "server-only";

import { estimateSpeechDurationMs } from "./tts-provider";
import type { SynthesizedSpeech, TTSProvider } from "./tts-provider";

/**
 * Real OpenAI TTS-backed provider (api.openai.com/v1/audio/speech). Not
 * exercised against the real API from this sandbox (no outbound network
 * to api.openai.com here - see the session's own notes) but real,
 * production code, consistent with openai-scene-provider.ts. A raw
 * fetch rather than the chat-completions-shaped AIProvider interface,
 * since TTS is a materially different request/response shape (binary
 * audio, not a chat message).
 */
export class OpenAITTSProvider implements TTSProvider {
  readonly name = "openai-tts-provider";

  async synthesizeSpeech(text: string, providerVoiceId: string): Promise<SynthesizedSpeech> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured.");
    }

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: providerVoiceId,
        input: text,
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`OpenAI TTS request failed (${response.status}): ${errorBody.slice(0, 500)}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      audioBase64: Buffer.from(arrayBuffer).toString("base64"),
      format: "mp3",
      approximateDurationMs: estimateSpeechDurationMs(text),
    };
  }
}
