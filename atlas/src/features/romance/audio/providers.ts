import "server-only";

import { TestAudioStorageProvider } from "./audio-storage-provider";
import type { AudioStorageProvider } from "./audio-storage-provider";
import { OpenAITTSProvider } from "./openai-tts-provider";
import { SupabaseAudioStorageProvider } from "./supabase-audio-storage-provider";
import { TestTTSProvider } from "./tts-provider";
import type { TTSProvider } from "./tts-provider";

let cachedTTS: TTSProvider | null = null;
let cachedStorage: AudioStorageProvider | null = null;

/** Runtime default: TestTTSProvider when no real key is configured, never a silent fake-as-real. */
export function getTTSProvider(): TTSProvider {
  if (cachedTTS) return cachedTTS;
  cachedTTS = process.env.OPENAI_API_KEY ? new OpenAITTSProvider() : new TestTTSProvider();
  return cachedTTS;
}

/** Runtime default: TestAudioStorageProvider when Supabase isn't configured, never a silent fake-as-real. */
export function getAudioStorageProvider(): AudioStorageProvider {
  if (cachedStorage) return cachedStorage;
  cachedStorage =
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
      ? new SupabaseAudioStorageProvider()
      : new TestAudioStorageProvider();
  return cachedStorage;
}
