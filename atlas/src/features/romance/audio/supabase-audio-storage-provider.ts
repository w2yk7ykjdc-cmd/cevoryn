import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { AudioStorageProvider, UploadedAudio } from "./audio-storage-provider";

/**
 * Real Supabase Storage-backed provider. Not exercised against the real
 * bucket from this sandbox (no outbound network to supabase.co here).
 * One-time manual setup this code depends on: a Storage bucket named
 * "romance-audio" must exist in the Supabase project (private, not
 * public - playback goes through signed URLs only, see
 * getPlaybackUrl()). Uses the service-role key (server-only, never sent
 * to the client) - consistent with this being a server-only orchestration
 * concern, never a client-side upload.
 */
const BUCKET_NAME = "romance-audio";
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour - long enough for one playback session, short enough not to be a durable public link.

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase URL/service role key are not configured.");
  }
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

export class SupabaseAudioStorageProvider implements AudioStorageProvider {
  readonly name = "supabase-audio-storage-provider";

  async uploadAudio(path: string, audioBase64: string, format: "mp3"): Promise<UploadedAudio> {
    const client = getAdminClient();
    const bytes = Buffer.from(audioBase64, "base64");

    const { error } = await client.storage.from(BUCKET_NAME).upload(path, bytes, {
      contentType: format === "mp3" ? "audio/mpeg" : "application/octet-stream",
      upsert: true,
    });

    if (error) {
      throw new Error(`Supabase Storage upload failed: ${error.message}`);
    }

    return { storagePath: path };
  }

  async getPlaybackUrl(storagePath: string): Promise<string> {
    const client = getAdminClient();
    const { data, error } = await client.storage
      .from(BUCKET_NAME)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

    if (error || !data) {
      throw new Error(`Supabase Storage signed URL failed: ${error?.message ?? "unknown error"}`);
    }

    return data.signedUrl;
  }
}
