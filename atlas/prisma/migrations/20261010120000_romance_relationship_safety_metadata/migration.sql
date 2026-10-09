-- Relationship/family eligibility is explicit and fail-closed. Existing rows
-- cannot be assumed unrelated merely because they were previously playable.
CREATE TYPE "RomanceRelationshipSafety" AS ENUM (
  'UNRELATED',
  'FAMILY_MEMBER',
  'UNKNOWN'
);

ALTER TABLE "romance_story_characters"
  ADD COLUMN "relationship_to_player_safety" "RomanceRelationshipSafety"
  NOT NULL DEFAULT 'UNKNOWN';

-- Restore eligibility only for the authored adult cast whose content bible
-- explicitly establishes them as non-family romantic characters.
UPDATE "romance_story_characters"
SET "relationship_to_player_safety" = 'UNRELATED'
WHERE "slug" IN ('caelan', 'rival', 'wren')
  AND "universe_id" IN (
    SELECT "id"
    FROM "romance_universes"
    WHERE "slug" = 'thornbound'
  );
