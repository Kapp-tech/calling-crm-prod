-- Who to go and listen to — from data you already have, at no cost.
--
-- This is NOT a quality score. It measures whether a connected call turned into
-- a conversation at all, which is the cheapest honest proxy for engagement and
-- the thing that decides where a supervisor's listening time is best spent.
--
-- Two independent signals come out of it:
--   conv_rate_pct  how often a connected call reaches 90 seconds  (opening / engagement)
--   avg_conv_s     how long those conversations run once they start  (depth)
-- They move separately, and the pairing is what identifies the coaching need.
--
-- Read it with three caveats:
--   1. Long does not mean good. An unproductive call still accrues seconds.
--   2. Lead mix is a confounder. An agent fed colder or older leads scores lower
--      through no fault of their own — check allocation before drawing conclusions.
--   3. `connected` is the dialer's own verdict and is known to be unreliable
--      (it has reported NOT CONNECTED on a call with seven seconds of talk time).
--
-- Use it to target listening, not to rank people for consequences.
--
-- Run:  ssh <prod> 'sudo -u postgres psql -d counselling_crm -f -' < scripts/agent-conversation-baseline.sql

\set window_days 30
\set conversation_seconds 90
\set min_connected 50

SELECT COALESCE(u.name,'(unmatched)') AS agent,
       count(*)                                                      AS calls,
       count(*) FILTER (WHERE c.connected)                           AS connected,
       count(*) FILTER (WHERE COALESCE(c."talkTimeSeconds",0) >= :conversation_seconds) AS conv_90s,
       round(100.0 * count(*) FILTER (WHERE COALESCE(c."talkTimeSeconds",0) >= :conversation_seconds)
             / NULLIF(count(*) FILTER (WHERE c.connected),0), 1)     AS conv_rate_pct,
       round(avg(c."talkTimeSeconds") FILTER (WHERE COALESCE(c."talkTimeSeconds",0) >= :conversation_seconds)) AS avg_conv_s,
       round(sum(c."talkTimeSeconds")/3600.0, 1)                     AS talk_hours
FROM "CallLog" c
LEFT JOIN "User" u ON u.id = c."agentId"
WHERE c."receivedAt" > now() - (:'window_days' || ' days')::interval
  AND c."recordingUrl" IS NOT NULL
GROUP BY 1
-- Below this many connects the percentage is noise, not signal.
HAVING count(*) FILTER (WHERE c.connected) >= :min_connected
ORDER BY conv_rate_pct DESC NULLS LAST;
