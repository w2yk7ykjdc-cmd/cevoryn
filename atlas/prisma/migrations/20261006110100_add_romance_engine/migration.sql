-- CreateEnum
CREATE TYPE "RomanceSubscriptionPlan" AS ENUM ('FREE', 'PREMIUM');

-- CreateEnum
CREATE TYPE "RomanceSubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RomanceAuditActorType" AS ENUM ('PLAYER', 'SYSTEM', 'AI');

-- CreateEnum
CREATE TYPE "SpicePreference" AS ENUM ('FADE_TO_BLACK', 'SUGGESTIVE', 'EXPLICIT');

-- CreateEnum
CREATE TYPE "FaeRace" AS ENUM ('FAE', 'MORTAL', 'HALF_FAE');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "StorySessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "RomanceMemoryType" AS ENUM ('PROMISE', 'BARGAIN', 'DEBT', 'SECRET', 'RELATIONSHIP_EVENT', 'USER_FACT', 'CHARACTER_FACT', 'WORLD_EVENT', 'DISCOVERED_TRUTH', 'ITEM', 'LOCATION', 'BETRAYAL', 'PREFERENCE');

-- CreateEnum
CREATE TYPE "RomanceMemorySource" AS ENUM ('USER_STATED', 'CHARACTER_STATED', 'SYSTEM_INFERRED', 'NARRATION');

-- CreateEnum
CREATE TYPE "RomanceMemoryStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'RETRACTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RomanceMemoryValidity" AS ENUM ('PERMANENT', 'SCOPED_TO_SEASON', 'SCOPED_TO_BEAT');

-- CreateEnum
CREATE TYPE "CanonFactType" AS ENUM ('WORLD_STATE', 'BARGAIN_TERM', 'PROMISE_TERM', 'DEBT_TERM', 'CHARACTER_KNOWLEDGE', 'REVEALED_SECRET');

-- CreateEnum
CREATE TYPE "BargainStatus" AS ENUM ('PROPOSED', 'SEALED', 'FULFILLED', 'BROKEN');

-- CreateEnum
CREATE TYPE "PromiseStatus" AS ENUM ('MADE', 'FULFILLED', 'BROKEN', 'FORGIVEN');

-- CreateEnum
CREATE TYPE "DebtStatus" AS ENUM ('OPEN', 'REPAID', 'FORGIVEN', 'ESCALATED');

-- CreateEnum
CREATE TYPE "VoiceSourceType" AS ENUM ('HUMAN', 'LICENSED', 'AI');

-- CreateEnum
CREATE TYPE "AudioRenderStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "StoryEventType" AS ENUM ('INTENT_RESOLVED', 'INTENT_REJECTED', 'SCENE_GENERATED', 'CANON_VALIDATION_FAILED', 'RELATIONSHIP_CHANGED', 'BARGAIN_PROPOSED', 'BARGAIN_SEALED', 'BARGAIN_BROKEN', 'PROMISE_MADE', 'PROMISE_RESOLVED', 'DEBT_OPENED', 'DEBT_RESOLVED', 'SECRET_REVEALED', 'BEAT_ENTERED', 'BEAT_EXITED');

-- CreateTable
CREATE TABLE "romance_players" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "age_verified_at" TIMESTAMP(3),
    "spice_preference" "SpicePreference" NOT NULL DEFAULT 'FADE_TO_BLACK',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "romance_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_subscriptions" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "plan" "RomanceSubscriptionPlan" NOT NULL DEFAULT 'FREE',
    "status" "RomanceSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "provider" TEXT,
    "provider_customer_id" TEXT,
    "current_period_end" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "romance_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_audit_logs" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "actor_type" "RomanceAuditActorType" NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "romance_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_universes" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "romance_universes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_seasons" (
    "id" TEXT NOT NULL,
    "universe_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "season_number" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "synopsis" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "romance_seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_beats" (
    "id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "beat_order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "entry_conditions" JSONB NOT NULL DEFAULT '{}',
    "exit_conditions" JSONB NOT NULL DEFAULT '{}',
    "available_actions" TEXT[],
    "state_effects" JSONB NOT NULL DEFAULT '{}',
    "character_involvement" TEXT[],
    "canon_fact_templates" JSONB NOT NULL DEFAULT '[]',
    "is_fail_state" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "romance_beats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_scene_variants" (
    "id" TEXT NOT NULL,
    "beat_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "selection_criteria" JSONB NOT NULL DEFAULT '{}',
    "audio_eligible" BOOLEAN NOT NULL DEFAULT false,
    "prompt_template" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "romance_scene_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_story_characters" (
    "id" TEXT NOT NULL,
    "universe_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "race" "FaeRace" NOT NULL,
    "is_voiced" BOOLEAN NOT NULL DEFAULT true,
    "personality" JSONB NOT NULL DEFAULT '{}',
    "goals" TEXT[],
    "fears" TEXT[],
    "values" TEXT[],
    "speech_style" TEXT NOT NULL,
    "forbidden_behavior" TEXT[],
    "knowledge_scope_rule" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "romance_story_characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_character_secrets" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "secret_key" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "reveal_condition_beat_slug" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "romance_character_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_voice_profiles" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "source_type" "VoiceSourceType" NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_voice_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "romance_voice_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_player_characters" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "universe_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pronouns" TEXT NOT NULL,
    "appearance_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "romance_player_characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_story_sessions" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "universe_id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,
    "player_character_id" TEXT NOT NULL,
    "pinned_universe_version" INTEGER NOT NULL,
    "pinned_season_version" INTEGER NOT NULL,
    "status" "StorySessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_beat_id" TEXT,
    "spice_preference" "SpicePreference" NOT NULL DEFAULT 'FADE_TO_BLACK',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_played_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "romance_story_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_story_events" (
    "id" TEXT NOT NULL,
    "story_session_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "beat_id" TEXT,
    "type" "StoryEventType" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "romance_story_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_relationship_states" (
    "id" TEXT NOT NULL,
    "story_session_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "character_slug" TEXT NOT NULL,
    "trust" INTEGER NOT NULL DEFAULT 0,
    "attraction" INTEGER NOT NULL DEFAULT 0,
    "fear" INTEGER NOT NULL DEFAULT 0,
    "loyalty" INTEGER NOT NULL DEFAULT 0,
    "tension" INTEGER NOT NULL DEFAULT 0,
    "true_name_compel_used" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "romance_relationship_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_memories" (
    "id" TEXT NOT NULL,
    "story_session_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "type" "RomanceMemoryType" NOT NULL,
    "subject" TEXT NOT NULL,
    "object" TEXT,
    "content" TEXT NOT NULL,
    "source" "RomanceMemorySource" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" "RomanceMemoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "validity" "RomanceMemoryValidity" NOT NULL DEFAULT 'PERMANENT',
    "related_character_slug" TEXT,
    "related_beat_slug" TEXT,
    "supersedes_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "romance_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_canon_facts" (
    "id" TEXT NOT NULL,
    "story_session_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "fact_type" "CanonFactType" NOT NULL,
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source_story_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "romance_canon_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_bargains" (
    "id" TEXT NOT NULL,
    "story_session_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "character_slug" TEXT NOT NULL,
    "terms" TEXT NOT NULL,
    "breach_consequence" TEXT NOT NULL,
    "proposer_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "counterparty_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "status" "BargainStatus" NOT NULL DEFAULT 'PROPOSED',
    "sealed_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "romance_bargains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_promises" (
    "id" TEXT NOT NULL,
    "story_session_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "character_slug" TEXT NOT NULL,
    "made_by" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "due_beat_slug" TEXT,
    "status" "PromiseStatus" NOT NULL DEFAULT 'MADE',
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "romance_promises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_debts" (
    "id" TEXT NOT NULL,
    "story_session_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "owed_by_character_slug" TEXT,
    "owed_to_character_slug" TEXT,
    "reason" TEXT NOT NULL,
    "due_beat_slug" TEXT,
    "status" "DebtStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "romance_debts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_audio_assets" (
    "id" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "romance_audio_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_audio_renders" (
    "id" TEXT NOT NULL,
    "story_event_id" TEXT NOT NULL,
    "voice_profile_id" TEXT NOT NULL,
    "voice_profile_version" INTEGER NOT NULL,
    "status" "AudioRenderStatus" NOT NULL DEFAULT 'PENDING',
    "audio_asset_id" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "romance_audio_renders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "romance_notifications" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "romance_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "romance_players_user_id_key" ON "romance_players"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "romance_subscriptions_player_id_key" ON "romance_subscriptions"("player_id");

-- CreateIndex
CREATE INDEX "romance_audit_logs_player_id_created_at_idx" ON "romance_audit_logs"("player_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "romance_universes_slug_version_key" ON "romance_universes"("slug", "version");

-- CreateIndex
CREATE UNIQUE INDEX "romance_seasons_universe_id_slug_version_key" ON "romance_seasons"("universe_id", "slug", "version");

-- CreateIndex
CREATE INDEX "romance_beats_season_id_beat_order_idx" ON "romance_beats"("season_id", "beat_order");

-- CreateIndex
CREATE UNIQUE INDEX "romance_beats_season_id_slug_version_key" ON "romance_beats"("season_id", "slug", "version");

-- CreateIndex
CREATE UNIQUE INDEX "romance_scene_variants_beat_id_slug_version_key" ON "romance_scene_variants"("beat_id", "slug", "version");

-- CreateIndex
CREATE UNIQUE INDEX "romance_story_characters_universe_id_slug_version_key" ON "romance_story_characters"("universe_id", "slug", "version");

-- CreateIndex
CREATE UNIQUE INDEX "romance_character_secrets_character_id_secret_key_key" ON "romance_character_secrets"("character_id", "secret_key");

-- CreateIndex
CREATE UNIQUE INDEX "romance_voice_profiles_character_id_key" ON "romance_voice_profiles"("character_id");

-- CreateIndex
CREATE UNIQUE INDEX "romance_player_characters_player_id_universe_id_key" ON "romance_player_characters"("player_id", "universe_id");

-- CreateIndex
CREATE INDEX "romance_story_sessions_player_id_status_idx" ON "romance_story_sessions"("player_id", "status");

-- CreateIndex
CREATE INDEX "romance_story_events_story_session_id_created_at_idx" ON "romance_story_events"("story_session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "romance_relationship_states_story_session_id_character_slug_key" ON "romance_relationship_states"("story_session_id", "character_slug");

-- CreateIndex
CREATE INDEX "romance_memories_story_session_id_status_type_idx" ON "romance_memories"("story_session_id", "status", "type");

-- CreateIndex
CREATE INDEX "romance_memories_story_session_id_subject_object_idx" ON "romance_memories"("story_session_id", "subject", "object");

-- CreateIndex
CREATE INDEX "romance_canon_facts_story_session_id_fact_type_idx" ON "romance_canon_facts"("story_session_id", "fact_type");

-- CreateIndex
CREATE INDEX "romance_bargains_story_session_id_status_idx" ON "romance_bargains"("story_session_id", "status");

-- CreateIndex
CREATE INDEX "romance_promises_story_session_id_status_idx" ON "romance_promises"("story_session_id", "status");

-- CreateIndex
CREATE INDEX "romance_debts_story_session_id_status_idx" ON "romance_debts"("story_session_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "romance_audio_renders_story_event_id_voice_profile_version_key" ON "romance_audio_renders"("story_event_id", "voice_profile_version");

-- CreateIndex
CREATE INDEX "romance_notifications_player_id_is_read_created_at_idx" ON "romance_notifications"("player_id", "is_read", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "romance_subscriptions" ADD CONSTRAINT "romance_subscriptions_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "romance_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_audit_logs" ADD CONSTRAINT "romance_audit_logs_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "romance_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_seasons" ADD CONSTRAINT "romance_seasons_universe_id_fkey" FOREIGN KEY ("universe_id") REFERENCES "romance_universes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_beats" ADD CONSTRAINT "romance_beats_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "romance_seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_scene_variants" ADD CONSTRAINT "romance_scene_variants_beat_id_fkey" FOREIGN KEY ("beat_id") REFERENCES "romance_beats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_story_characters" ADD CONSTRAINT "romance_story_characters_universe_id_fkey" FOREIGN KEY ("universe_id") REFERENCES "romance_universes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_character_secrets" ADD CONSTRAINT "romance_character_secrets_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "romance_story_characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_voice_profiles" ADD CONSTRAINT "romance_voice_profiles_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "romance_story_characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_player_characters" ADD CONSTRAINT "romance_player_characters_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "romance_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_player_characters" ADD CONSTRAINT "romance_player_characters_universe_id_fkey" FOREIGN KEY ("universe_id") REFERENCES "romance_universes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_story_sessions" ADD CONSTRAINT "romance_story_sessions_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "romance_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_story_sessions" ADD CONSTRAINT "romance_story_sessions_universe_id_fkey" FOREIGN KEY ("universe_id") REFERENCES "romance_universes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_story_sessions" ADD CONSTRAINT "romance_story_sessions_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "romance_seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_story_sessions" ADD CONSTRAINT "romance_story_sessions_player_character_id_fkey" FOREIGN KEY ("player_character_id") REFERENCES "romance_player_characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_story_sessions" ADD CONSTRAINT "romance_story_sessions_current_beat_id_fkey" FOREIGN KEY ("current_beat_id") REFERENCES "romance_beats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_story_events" ADD CONSTRAINT "romance_story_events_story_session_id_fkey" FOREIGN KEY ("story_session_id") REFERENCES "romance_story_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_story_events" ADD CONSTRAINT "romance_story_events_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "romance_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_relationship_states" ADD CONSTRAINT "romance_relationship_states_story_session_id_fkey" FOREIGN KEY ("story_session_id") REFERENCES "romance_story_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_relationship_states" ADD CONSTRAINT "romance_relationship_states_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "romance_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_memories" ADD CONSTRAINT "romance_memories_story_session_id_fkey" FOREIGN KEY ("story_session_id") REFERENCES "romance_story_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_memories" ADD CONSTRAINT "romance_memories_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "romance_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_canon_facts" ADD CONSTRAINT "romance_canon_facts_story_session_id_fkey" FOREIGN KEY ("story_session_id") REFERENCES "romance_story_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_canon_facts" ADD CONSTRAINT "romance_canon_facts_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "romance_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_bargains" ADD CONSTRAINT "romance_bargains_story_session_id_fkey" FOREIGN KEY ("story_session_id") REFERENCES "romance_story_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_bargains" ADD CONSTRAINT "romance_bargains_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "romance_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_promises" ADD CONSTRAINT "romance_promises_story_session_id_fkey" FOREIGN KEY ("story_session_id") REFERENCES "romance_story_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_promises" ADD CONSTRAINT "romance_promises_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "romance_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_debts" ADD CONSTRAINT "romance_debts_story_session_id_fkey" FOREIGN KEY ("story_session_id") REFERENCES "romance_story_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_debts" ADD CONSTRAINT "romance_debts_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "romance_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_audio_renders" ADD CONSTRAINT "romance_audio_renders_voice_profile_id_fkey" FOREIGN KEY ("voice_profile_id") REFERENCES "romance_voice_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_audio_renders" ADD CONSTRAINT "romance_audio_renders_audio_asset_id_fkey" FOREIGN KEY ("audio_asset_id") REFERENCES "romance_audio_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "romance_notifications" ADD CONSTRAINT "romance_notifications_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "romance_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
