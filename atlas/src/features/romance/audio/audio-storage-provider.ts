/**
 * Audio storage provider abstraction - separates "where rendered audio
 * bytes live" from the render orchestration, so the actual backend
 * (Supabase Storage today) is swappable (brief §26). No Prisma, no
 * "server-only" here, same reasoning as tts-provider.ts.
 */

export interface UploadedAudio {
  storagePath: string;
}

export interface AudioStorageProvider {
  readonly name: string;
  uploadAudio(path: string, audioBase64: string, format: "mp3"): Promise<UploadedAudio>;
  /** A time-limited URL the player can fetch the audio from directly. */
  getPlaybackUrl(storagePath: string): Promise<string>;
}

/** Deterministic test double - stores nothing real, never calls a network. */
export class TestAudioStorageProvider implements AudioStorageProvider {
  readonly name = "test-audio-storage-provider";
  private readonly store = new Map<string, string>();

  async uploadAudio(path: string, audioBase64: string, format: "mp3"): Promise<UploadedAudio> {
    void format;
    this.store.set(path, audioBase64);
    return { storagePath: path };
  }

  async getPlaybackUrl(storagePath: string): Promise<string> {
    return `test://romance-audio/${encodeURIComponent(storagePath)}`;
  }

  has(path: string): boolean {
    return this.store.has(path);
  }
}
