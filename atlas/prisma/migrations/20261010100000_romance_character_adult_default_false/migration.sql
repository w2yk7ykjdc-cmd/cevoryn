-- Existing rows were created while the column default was true, so that value
-- cannot be treated as proof of age eligibility. Fail closed for every row,
-- then explicitly restore eligibility only for the three authored adult
-- characters in the shipped Thornbound universe. Other content must be
-- reviewed and opted in explicitly.
ALTER TABLE "romance_story_characters"
  ALTER COLUMN "is_adult" SET DEFAULT false;

UPDATE "romance_story_characters"
SET "is_adult" = false;

UPDATE "romance_story_characters"
SET "is_adult" = true
WHERE "slug" IN ('caelan', 'rival', 'wren')
  AND "universe_id" IN (
    SELECT "id"
    FROM "romance_universes"
    WHERE "slug" = 'thornbound'
  );
