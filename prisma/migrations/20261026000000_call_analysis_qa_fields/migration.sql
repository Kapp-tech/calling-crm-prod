-- The analyser's verdict fields, promoted out of `raw` into real columns.
--
-- They were readable from the JSON already, but the Call Analysis listing
-- filters and sorts on grade, intent, review flag and scored date — and a
-- JSONB predicate on every row is the wrong tool for a screen someone pages
-- through.
--
-- Additive and guarded, so it is safe to re-run and safe against a database
-- where an earlier hand-applied attempt got partway.

ALTER TABLE "CallAnalysis"
  ADD COLUMN IF NOT EXISTS "qaStatus"    TEXT,
  ADD COLUMN IF NOT EXISTS "qaGrade"     TEXT,
  ADD COLUMN IF NOT EXISTS "intent"      TEXT,
  -- NOT NULL with a default: absent means "no breach found", not "unknown".
  -- Every existing row predates the analyser, so false is correct for them.
  ADD COLUMN IF NOT EXISTS "fatalError"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "needsReview" BOOLEAN NOT NULL DEFAULT false,
  -- Nullable, unlike the booleans: an empty array means "looked, found none",
  -- while null means the tool did not report on it at all.
  ADD COLUMN IF NOT EXISTS "redFlags"    JSONB,
  ADD COLUMN IF NOT EXISTS "scoredAt"    TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "CallAnalysis_scoredAt_idx"    ON "CallAnalysis"("scoredAt");
CREATE INDEX IF NOT EXISTS "CallAnalysis_qaGrade_idx"     ON "CallAnalysis"("qaGrade");
CREATE INDEX IF NOT EXISTS "CallAnalysis_needsReview_idx" ON "CallAnalysis"("needsReview");
CREATE INDEX IF NOT EXISTS "CallAnalysis_fatalError_idx"  ON "CallAnalysis"("fatalError");
