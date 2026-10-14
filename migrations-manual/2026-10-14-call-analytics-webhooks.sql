-- Call-analytics webhooks: outbound recording deliveries + inbound scores.
--
-- RUN THIS BEFORE DEPLOYING THE CODE. The regenerated Prisma client selects the
-- new columns, so code-first produces live query errors until the DDL lands.
-- Additive DDL is invisible to the currently running code, so this order is safe.
--
-- STEP 1 MUST RUN ON ITS OWN, NOT INSIDE BEGIN/COMMIT. Postgres refuses
-- ALTER TYPE ... ADD VALUE inside a transaction block.

-- ── Step 1: the new trigger value (standalone, autocommit) ──────────────────
ALTER TYPE "LeadIntegrationTrigger" ADD VALUE IF NOT EXISTS 'RECORDING_RECEIVED';

-- ── Step 2: everything else, atomic ─────────────────────────────────────────
BEGIN;

-- Deliveries can now belong to a call, and carry automatic-retry state.
-- ADD COLUMN inherits the table's existing grants, so no OWNER TO is needed
-- (unlike a new table — see step 3).
ALTER TABLE "LeadIntegrationLog"
  ADD COLUMN IF NOT EXISTS "callLogId"   TEXT,
  ADD COLUMN IF NOT EXISTS "attempt"     INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3);

ALTER TABLE "LeadIntegrationLog"
  DROP CONSTRAINT IF EXISTS "LeadIntegrationLog_callLogId_fkey";
ALTER TABLE "LeadIntegrationLog"
  ADD CONSTRAINT "LeadIntegrationLog_callLogId_fkey"
  FOREIGN KEY ("callLogId") REFERENCES "CallLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "LeadIntegrationLog_callLogId_idx"   ON "LeadIntegrationLog"("callLogId");
-- The retry sweeper's only query is "what is due now", so this is the index
-- that keeps it from scanning every delivery ever made.
CREATE INDEX IF NOT EXISTS "LeadIntegrationLog_nextRetryAt_idx" ON "LeadIntegrationLog"("nextRetryAt");

-- ── Step 3: results from the analytics tool ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "CallAnalysis" (
  "id"         TEXT NOT NULL,
  "callLogId"  TEXT NOT NULL,
  "score"      DOUBLE PRECISION,
  "maxScore"   DOUBLE PRECISION,
  "summary"    TEXT,
  "feedback"   TEXT,
  "metrics"    JSONB,
  "raw"        JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CallAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CallAnalysis_callLogId_key" ON "CallAnalysis"("callLogId");
CREATE INDEX IF NOT EXISTS "CallAnalysis_score_idx"            ON "CallAnalysis"("score");
CREATE INDEX IF NOT EXISTS "CallAnalysis_receivedAt_idx"       ON "CallAnalysis"("receivedAt");

ALTER TABLE "CallAnalysis"
  DROP CONSTRAINT IF EXISTS "CallAnalysis_callLogId_fkey";
ALTER TABLE "CallAnalysis"
  ADD CONSTRAINT "CallAnalysis_callLogId_fkey"
  FOREIGN KEY ("callLogId") REFERENCES "CallLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A NEW TABLE created via `sudo -u postgres psql` is owned by postgres, and the
-- app connects as `crm` — without this it gets "permission denied for table".
-- This is the step that took All Leads to 0 rows on 18 Aug.
--
-- Guarded so the same script runs on a developer machine, where the database is
-- owned by the local user and no `crm` role exists. Skipping it there is right;
-- skipping it on production is the bug, which is why the verify query below
-- checks ownership rather than trusting this ran.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm') THEN
    EXECUTE 'ALTER TABLE "CallAnalysis" OWNER TO crm';
  ELSE
    RAISE NOTICE 'role crm not present — leaving CallAnalysis owner unchanged (expected on local dev)';
  END IF;
END
$$;

COMMIT;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- SELECT tablename, tableowner FROM pg_tables
--   WHERE schemaname='public' AND tableowner <> 'crm';          -- expect 0 rows
-- SELECT unnest(enum_range(NULL::"LeadIntegrationTrigger"));    -- expect RECORDING_RECEIVED
