-- Existing character eligibility is preserved. Only the default for newly created
-- or incompletely configured characters changes: adult eligibility must be
-- explicitly asserted before sexual content can pass CANON-006.
ALTER TABLE "romance_story_characters"
  ALTER COLUMN "is_adult" SET DEFAULT false;
