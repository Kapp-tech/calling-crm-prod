-- Serves the phone-number fallback in lib/call-scores.ts.
--
-- A lead's calls are those the webhook attributed to it, plus any call that
-- matched no lead at all and carries the lead's number (lib/call-log-matching.ts).
-- The second rule is a trailing-digits comparison, which a plain btree index on
-- "phoneNumber" cannot serve — without this index, showing the Call Score
-- column on All Leads means scanning "CallLog" on every page of the busiest
-- screen in the CRM.
--
-- Partial on "leadId" IS NULL because that is the only case the fallback looks
-- at: a call already attributed to a lead is never matched by number. On
-- production most rows are attributed, so the index stays small.
--
-- RIGHT("phoneNumber", 10) is exactly the endsWith(tail) test callsForLead
-- performs, so the index and the application rule cannot drift apart.
CREATE INDEX IF NOT EXISTS "CallLog_phone_tail_unmatched_idx"
  ON "CallLog" (RIGHT("phoneNumber", 10))
  WHERE "leadId" IS NULL;
