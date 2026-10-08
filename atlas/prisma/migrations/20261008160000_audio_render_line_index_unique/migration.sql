-- DropIndex
DROP INDEX "romance_audio_renders_story_event_id_voice_profile_version_key";

-- AlterTable
ALTER TABLE "romance_audio_renders" ADD COLUMN     "line_index" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "romance_audio_renders_story_event_id_line_index_voice_profi_key" ON "romance_audio_renders"("story_event_id", "line_index", "voice_profile_id", "voice_profile_version");

