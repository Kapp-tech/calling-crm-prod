-- Call-analytics webhooks: outbound recording deliveries + inbound scores.
--
-- Safe to run inside Prisma's transaction. ALTER TYPE ... ADD VALUE could not
-- run in one before PostgreSQL 12; both servers here are 17/18, and the value
-- is not USED anywhere in this file, which is the remaining restriction.
--
-- Every statement is guarded. This project applied its DDL by hand from June
-- onwards, so these objects already exist on the old server — a bare CREATE
-- would fail there, and a migration that cannot be re-run is a migration you
-- cannot recover with.

-- ── The new trigger ─────────────────────────────────────────────────────────
ALTER TYPE "LeadIntegrationTrigger" ADD VALUE IF NOT EXISTS 'RECORDING_RECEIVED';

-- ── Deliveries can belong to a call, and carry automatic-retry state ────────
-- ADD COLUMN inherits the table's existing grants, so no ownership fix is
-- needed here — unlike the new table below.
ALTER TABLE "LeadIntegrationLog"
  ADD COLUMN IF NOT EXISTS "callLogId"   TEXT,
  ADD COLUMN IF NOT EXISTS "attempt"     INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "LeadIntegrationLog_callLogId_idx"   ON "LeadIntegrationLog"("callLogId");
-- The retry sweeper's only query is "what is due now".
CREATE INDEX IF NOT EXISTS "LeadIntegrationLog_nextRetryAt_idx" ON "LeadIntegrationLog"("nextRetryAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LeadIntegrationLog_callLogId_fkey'
  ) THEN
    ALTER TABLE "LeadIntegrationLog"
      ADD CONSTRAINT "LeadIntegrationLog_callLogId_fkey"
      FOREIGN KEY ("callLogId") REFERENCES "CallLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- ── Results from the analytics tool ─────────────────────────────────────────
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CallAnalysis_callLogId_fkey') THEN
    ALTER TABLE "CallAnalysis"
      ADD CONSTRAINT "CallAnalysis_callLogId_fkey"
      FOREIGN KEY ("callLogId") REFERENCES "CallLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- ── Ownership ───────────────────────────────────────────────────────────────
-- A new table takes the owner of whoever ran this. Applied by Prisma that is
-- the app's own user and already right; run by hand as a superuser it is not,
-- and the app then gets "permission denied for table" — which took All Leads
-- to 0 rows on 18 Aug.
--
-- Copied from CallLog rather than named outright, because the role differs by
-- server: the old box connects as `crm`, the new one as `crm_user`. Matching a
-- neighbouring table is correct on both and needs no edit.
DO $$
DECLARE target_owner TEXT;
BEGIN
  SELECT tableowner INTO target_owner FROM pg_tables
   WHERE schemaname = 'public' AND tablename = 'CallLog';

  IF target_owner IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "CallAnalysis" OWNER TO %I', target_owner);
    RAISE NOTICE 'CallAnalysis owner set to %, matching CallLog', target_owner;
  ELSE
    RAISE WARNING 'CallLog not found — leaving CallAnalysis owner unchanged; check it by hand';
  END IF;
END
$$;
