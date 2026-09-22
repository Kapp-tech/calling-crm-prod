# Pending deployment

Working notes for the next release. **Nothing listed under "waiting" is
deployed.** Do not deploy until Himanshu explicitly says so.

Last verified: **2026-09-05 17:15 IST, after the deploy of `a91fba4`**
Production is on commit **`a91fba4`**; local `HEAD` is the same and nothing is
unpushed (`.claude/settings.json` carries an uncommitted tooling-only change the
permission classifier declined to commit). pm2 `crm` is online, `/login` returns
200 publicly and locally, and memory sits at 533 MB available.

**This deploy cost ZERO error lines** — 11,110 lines and 164 `P2024` before and
after, not one new. Three deploys, three different outcomes: `a60a19f` 1,838
lines from 398 MB free, `2425daf` 355 from 177 MB, `a91fba4` none from 167 MB.
Free memory tracks none of it. Build duration and how many agents happen to be
mid-request do — see §5. The narrow connection pool is still the underlying
cause and is still unfixed.

---

## 1. What is waiting to go out

### Masking no longer blocks WhatsApp or the receipt form  *(code only, no DDL)*

Himanshu: with data masking on, the WhatsApp button disappears, and the
Application/Admission form cannot be submitted at all — "invalid email".

Both came from the same design: masking works by never sending the real email or
phone to the browser, so a masked agent's copy of a lead reads
`ab****@gmail.com` and `98****60`. That is the right way to mask, but two
features were reading those values as if they were real.

**WhatsApp.** `WhatsAppButton` hid itself whenever the phone contained an
asterisk — there was no number to build a `wa.me` link from. But masking exists
so numbers cannot be *collected* in bulk, not so an agent may never message the
lead they were assigned. New route `app/api/leads/[id]/whatsapp` resolves the
number from the lead id server-side and 302s to `wa.me`, the same way Call
already dials without the number reaching the page. Gated by `canAccessLead`, so
it widens nothing: verified 401 logged out, 404 for a lead the agent does not
own. The button picks the path by testing the phone for an asterisk rather than
by checking the role, so it cannot drift out of step with the permission.

The number does appear in the WhatsApp tab that opens. That is inherent — `wa.me`
addresses a chat by number — so the protection kept is the one doing real work
(no bulk access); the exposure is one lead, on a deliberate click.

**The receipt form.** Confirmed by test that only `email` actually failed
validation (zod `.email()` rejects `ra****@gmail.com`); `mobile` passed but would
have **stored `98****60` on the receipt**, which is bad data on a record someone
approves later. The route now substitutes the lead's stored name/email/phone
before validating — but only for a masked role, and only where the submitted
value still contains an asterisk. An agent who gets a corrected email on the call
can still clear the box and type it, and it is kept as typed. Both paths verified
end-to-end against a throwaway masked agent: masked submission stored the real
address, typed correction stored the correction. Probe user, leads, receipts and
files removed afterwards.

Display stays masked throughout — nothing real is ever sent back to the browser.

Files: `app/api/leads/[id]/whatsapp/route.ts` (new),
`app/api/leads/[id]/receipts/route.ts`, `components/shared/whatsapp-button.tsx`,
`lib/whatsapp.ts` (new — the two pure link helpers moved out of the `'use client'`
module so the server can call them), and the two button call sites.

### DialShree ID, and Client Type on Assign Leads  *(code only, no DDL)*

Three display/filter additions, all reading columns that already exist:
User Management shows the `dialshreeId` column; Assign Leads shows a Client Type
column; and Client Type joins the Assign Leads filter set, with an "NA" option
covering leads whose college is unset or not in the list. The filter clause
mirrors the existing `sessionYearClause` and is shared by both the list and the
"Select all" id query, so a select-all after filtering cannot pick up rows the
list never showed.

### The CSV export no longer takes the CRM down  *(code only, no DDL)*

Himanshu: downloading from All Leads was taking minutes and agents were left
staring at "Application error: a client-side exception has occurred".

**It was not server capacity — the route had no limit of any kind.** No `take`,
no batching, no streaming. It loaded every matching lead *with every follow-up
attached* into memory, built the whole CSV as one string, and only then sent it.
Against 134,747 leads and 103,101 follow-ups on a 908 MB box that is enough to
push the machine into swap and starve everything else of a connection. The log
showed exactly that: 122 `P2024` in 3,000 lines, with **83 failures on
`/api/v1/leads`** (incoming leads rejected) and **19 on `lead-feedback POST`**
(agents unable to save follow-ups). One click on Download could take the CRM out
for the whole floor.

Three changes to `app/api/leads/export/route.ts`:

1. **Streamed in cursor-paginated batches of 1,000.** Returns a `ReadableStream`
   and writes each page as it is formatted, so memory stays flat regardless of
   size and the browser starts receiving data immediately.
2. **A 50,000-row cap** — beyond that it returns 413 asking for a narrower
   filter, so no single click can ask for the entire book again.
3. **One export at a time per process.** On a single physical core, three agents
   clicking Download together is three full scans competing for the same CPU.
   Others get a 429 telling them to wait.

**Two things a careless version would have got wrong:**

* **The follow-up columns are dynamic** — `Follow-up 1..N`, where N is the
  deepest follow-up count in the result set. The old code knew N only *after*
  loading everything, which is precisely what we stopped doing. It now comes
  from one `MAX(followUpNumber)` aggregate before the stream opens. Get this
  wrong and the header silently stops matching the rows.
* **Cursor, not `skip`/`take`.** OFFSET makes the database re-walk every row it
  has already returned, so page 100 costs a hundred times page 1. And `id` is
  the tiebreaker because `createdAt` is not unique — a tie would drop or repeat
  rows across a page boundary.

The audit trail is kept and now records the rows *actually written*, so an
interrupted download is logged as what it was rather than what was requested.

Verified locally (1,015 leads, so two batches — the boundary is the interesting
case):

| check | result |
|---|---|
| rows returned | 1,015 data rows, 57 columns |
| unique Lead IDs | 1,015 — **zero duplicates**, matching the table exactly |
| time to first byte | 0.79 s |
| cap (temporarily set to 100) | 413 — *"That is 1,015 leads. Narrow the filters to 100 or fewer…"* |
| five simultaneous exports | 1 x 200, 4 x 429 |
| audit log | four `LEADS_EXPORTED` rows with the correct counts |

`tsc --noEmit` clean. The probe user created for the test, and its audit rows,
were removed afterwards.

**Still true after this:** a 130,000-row export is real CPU work on one physical
core and will be slow until the bigger server. The cap protects the floor
meanwhile, and the psql route remains the right tool for a full dump.

### Data change on production, 3 Sept — Connected Calls counts leads

Run directly on production, no deploy:

```sql
UPDATE "KpiDefinition" SET source = 'FEEDBACK_LEADS_LATEST' WHERE name = 'Connected Calls';
```

**Rollback**, if it is ever wanted: set `source` back to `FEEDBACK_COUNT`. The
`feedbackCategoryIds` narrowing was untouched by the change and still points at
the `Connected` category, which is what makes the two definitions coincide.

**Why.** It was the last KPI counting follow-up **rows** rather than **leads**,
so the Caller-wise report ran about 1% above every other report. Himanshu hit it
three times — 1,353 vs 1,339 on 31 Aug, then as a definition question, then as
768 vs 770 on 3 Sept. The two leads behind that last pair: Nisha chaudhary
logged *Taken Admission in Other University* twice on LID25553 **at the same
minute** (a double submit), and Saurabh Singh logged *Callback* twice on
LID24978, 45 minutes apart (a real second call). Rows counted both; leads count
each lead once.

**Verified before and after on live data**, whole floor, same day:

| | Connected Calls |
|---|---|
| before, counting rows | 830 |
| after, counting leads | **828** |
| Overall Calling Report | **828** |

Per agent, all sixteen now agree: only Nisha (61 → 60) and Saurabh (58 → 57)
moved, and both landed exactly on the figure the Overall Calling Report already
showed. `/api/kpi/targets` still answers and the error log gained nothing.

**Why it is exact rather than close:** zero leads have a latest feedback with no
category, so there is no third case for the two definitions to disagree on. If
an uncategorised option is ever added, both rules still exclude it from
Connected, so they stay aligned.

**Score impact:** Connected Calls carries 8 points against a target of 120, so
one lead is 0.07 of a point. Nisha and Saurabh each lost 0.1; nobody else moved.

**Worth doing separately:** Nisha's pair was the identical outcome at the
identical minute — a double submit, not two conversations. The definition change
stops it inflating a count, but the duplicate row is still written. A
double-submit guard on the feedback form would stop it at source.

## 2. Shipped on 2026-09-09 (`46a29df`, `8090474`)

*(Filed late — these went out on 9 Sept and sat in section 1 until 19 Sept. My bookkeeping slip, not a second deploy.)*

### Session/Year on the college, shown against every lead

Himanshu: a **Session/Year** field on the Manage Colleges popup — free text, "a
year like 2027" — shown in All Leads beside the KAPP ID, resolved from the
college so that *"I will update any year on any college and it will be changed
on all leads table."*

Built as a twin of **Client Type**, which already works exactly this way. Not
stored on the lead: read live from the college row on every request, which is
what makes an edit reach the leads that already exist.

**DDL — run BEFORE the code goes out.** Additive and transaction-safe, and
`ADD COLUMN` inherits the table's grants so no `OWNER TO crm` is needed:

```sql
BEGIN;
-- 1. the column itself
ALTER TABLE "DropdownOption" ADD COLUMN IF NOT EXISTS "collegeSessionYear" TEXT;

-- 2. a college may now exist once PER SESSION YEAR, so the uniqueness key
--    widens. NULLS NOT DISTINCT is load-bearing, not decoration: every
--    non-COLLEGE type leaves collegeSessionYear NULL, and under Postgres's
--    default (NULLS DISTINCT) two Lead Types both called "Hot" would silently
--    become legal. Verified against the real index that they are still
--    rejected. Postgres 15+ only; production is 18.6, local 17.10.
DROP INDEX IF EXISTS "DropdownOption_type_value_key";
CREATE UNIQUE INDEX IF NOT EXISTS "DropdownOption_type_value_collegeSessionYear_key"
  ON "DropdownOption" (type, value, "collegeSessionYear") NULLS NOT DISTINCT;
COMMIT;
```

The index will build cleanly: production has 50 colleges with 50 distinct names
and 50 distinct KAPP IDs, and every other dropdown type was already protected by
the old unique on `(type, value)`, so no duplicate key can exist.

`prisma migrate diff` will report this index, because Prisma cannot express
`NULLS NOT DISTINCT`. **That line is deliberate — do not "fix" it.** It is noted
in the schema next to the `@@unique`.

The regenerated Prisma client selects this column, so deploying first gives live
`Unknown field collegeSessionYear` errors on All Leads until the migration
lands. Order matters.

* **Free text, deliberately.** A 4-digit rule would reject `2026-27`, which is
  how plenty of Indian sessions are written. Trimmed and capped at 20
  characters, nothing more. Verified that both `2027` and `  2026-27  ` store
  and read back correctly.
* `lib/college-client-type.ts` became **`lib/college-lead-fields.ts`**, exporting
  `collegeLeadFields()` which returns `clientTypeOf` and `sessionYearOf` from
  **one** query. A second near-identical resolver would have meant a second
  query per request and a second place for the college-name matching rule to
  drift. Callers: the All Leads API and the CSV export.
* Unset reads **`NA`**, matching Client Type — the two columns sit next to each
  other and one reading "NA" while the other sat blank would look like a fault.
  Its own constant (`UNSET_SESSION_YEAR`) so either can change independently.
* Matching stays trimmed and lower-cased, because `Lead.college` is free text
  from uploads and the API while the college list is curated. Verified:
  `"SUSHANT UNIVERSITY "` resolves to the row stored as `Sushant University`.
* All Leads gains a **Session/Year** column immediately after KAPP College ID,
  and the CSV export gains the matching column in the same position, so the
  download reads as the screen does. Empty-state `colSpan` 29 → 30.

**Session/Year is also an Advanced Filter** (asked for straight after). It sits
next to Deal Type in the Lead Status group, offering the years an admin has
configured on colleges plus `NA`.

Filtering on it is not a column comparison — the value is on the college — so
`sessionYearClause()` resolves the selected years to college names and filters
`Lead.college`. Three things it has to get right, all verified:

* **`NA` covers three cases at once**: a college with the field empty, a lead
  with no college, and a lead whose college is not in the curated list. `NOT IN`
  alone would silently drop the null ones — in SQL `college NOT IN (...)` is
  unknown rather than true when `college` is NULL.
* **A year no college carries returns `in: []`**, matching nothing. Falling
  through to "no filter" would show every lead and read as the filter being
  ignored.
* **Case-insensitive throughout**, on both the year and the college name.

`buildNonFeedbackFilters` became **async** and now takes a `db` handle. That was
deliberate rather than bolting the clause onto the two list endpoints:
`hasAnyFilter` counts `sessionYear` as "a filter is set", and
**bulk-delete-by-filter relies on that guard** — a filter that registered as
scoping a delete but was not actually applied there would have let it run far
wider than the screen showed. Putting it in the shared builder made the compiler
find all five call sites, so it cannot be forgotten. The export route keeps its
own filter list, so it calls the exported `sessionYearClause` directly; the
"Download Filtered CSV" URL already carries every base param.

Verified against the local database (1,015 leads; one college set to 2027 with
403 leads, another to 2026-27 with 597):

| selection | rows | expected |
|---|---|---|
| `2027` | 403 | 403 |
| `2026-27` | 597 | 597 |
| both | 1,000 | 1,000 |
| `NA` | 15 | 15 |
| `2027` + `NA` | 418 | 418 |
| `1999` (nothing carries it) | 0 | 0 |
| `na` lower-case | 15 | 15 |

All seven correct, and the colleges were restored to their original values
afterwards. `/api/leads`, `/api/leads/ids`, `/api/leads/export`,
`/api/leads/filter-options`, `/api/leads/feedback-category-counts`,
`/api/leads/bulk-delete/preview` and All Leads all compile and answer.

**One college per KAPP College ID per session year, and only one active.**
Himanshu, after hitting "A college with this KAPP College ID already exists"
trying to add the 2027 intake: allow the same KAPP ID across years, block it
within a year, and *"for making a college for upcoming years only one
college/KAPP ID can be active"*.

So the sequence for a new intake is **deactivate 2026, then create 2027**, and
the error says exactly that instead of just refusing.

The second half of the rule is not bookkeeping — it is what keeps the rest of the
system unambiguous. Everything downstream resolves a college by name or KAPP ID
and expects one answer: the CSV upload turns a KAPP ID into one college name, and
All Leads reads Client Type and Session/Year from one college row. Two active
rows for one ID would make both of those whichever row the database returned
first.

The rule lives in **`lib/college-session.ts`** — pure, Prisma-free, called by
both the create and the edit path. Written twice it would have been sidestepped
immediately: create 2027 while 2026 is off, then switch 2026 back on and both are
live. The edit path guards activation and year changes for exactly that reason
(`kappCollegeId` is not editable there, so a row cannot move between IDs).

**Consumers now read the ACTIVE row**, which they did not need to before:
`collegeLeadFields` (was keying a name→attributes map that would have kept
whichever duplicate came last), `sessionYearClause`, and the filter-options year
list. `lib/dropdown-validation.ts` and the CSV page were already active-only.

The Manage Colleges list now shows each row's Session/Year beside its KAPP ID —
without it, two rows sharing a name and an ID are indistinguishable.

**⚠ The consequence to be clear about: there is no per-lead year history.**
`Lead.college` stores a college *name*, so a lead cannot point at one year's row
rather than another — it resolves through whichever row is active. Deactivate
2026 and activate 2027 and **every** lead for that college, including last
year's, reads 2027. That follows directly from the earlier requirement ("I will
update any year on any college and it will be changed on all leads table") and
they are the same mechanism. Per-lead history would mean stamping the year onto
the lead at ingest, which is the opposite behaviour — worth raising before anyone
assumes the reports will split by intake.

Verified: 14 cases against `collegeSessionConflict` — create with 2026 active
(blocked), 2026 inactive (allowed), the same year twice (blocked), no-year
duplicates (blocked), reactivating 2026 while 2027 is live (blocked) and while it
is not (allowed), changing a year onto a taken one (blocked) and a free one
(allowed), deactivating and editing an unrelated field (both allowed), and
whitespace handling (`"  2027  "` matches `2027`, `""` matches "no year"). All 14
correct. The live index itself verified for all four combinations, including that
non-COLLEGE duplicates are still rejected.

**A pre-existing bug fixed on the way past.** `openCreate` in the dropdown
manager never reset `collegeClientType`. Editing a college that had one set and
then clicking "Add Value" opened the form with that value still selected, and it
was saved onto the new college. Session/Year would have inherited the same leak,
so both are now cleared. **Worth checking whether any college carries a Client
Type nobody meant to set.**

Files: `prisma/schema.prisma`, `lib/college-lead-fields.ts` (new, replaces
`lib/college-client-type.ts`), `lib/college-attributes.ts`,
`app/api/dropdown-options/route.ts`, `app/api/dropdown-options/[id]/route.ts`,
`app/api/leads/route.ts`, `app/api/leads/export/route.ts`,
`components/admin/dropdown-options-manager.tsx`, `app/dashboard/leads/page.tsx`,
plus `lib/college-session.ts` (new) and the filter: `lib/lead-query-filters.ts`,
`app/api/leads/filter-options/route.ts`, `app/api/leads/ids/route.ts`,
`app/api/leads/feedback-category-counts/route.ts`,
`app/api/leads/bulk-delete/route.ts`,
`app/api/leads/bulk-delete/preview/route.ts`.

Verified: DDL applied locally; `prisma generate` run; `tsc --noEmit` clean; the
resolver demonstrated end to end against a college with 403 leads — unset reads
`NA`, setting `2027` reads `2027`, `  2026-27  ` trims correctly, an unknown or
null college reads `NA`, and the original value was restored afterwards; All
Leads, Manage Colleges, `/api/leads`, `/api/dropdown-options` and
`/api/leads/export` all compile and answer with no `Unknown field` error.

### Lead code validation on CSV upload

Himanshu: a lead code must be text only — `Utm100`, `sg`, `krs`, `MN_100`,
`RT_202`. Anything carrying a symbol other than underscore is invalid and the
row must not be inserted until it is corrected. `kollegeapply/msm23/API` and its
kind are the case in point.

The column is labelled **Lead Code** in the UI and carried as `campaign`
everywhere downstream. **It was never validated at all** — it passed straight
through both the browser check and the upload route.

**What that has already cost, measured on production.** 4,931 of 42,631 leads
(11.6%) hold a malformed code, across 380 distinct values:

| value | leads |
|---|---|
| `kollegeapply/bm101/API` | 1,618 |
| `kollegeapply/kapp01_ssa/2026` | 549 |
| `kollegeapply/bm100/API` | 429 |
| `kollegeapply/ma10/API` | 369 |
| a full URL with its UTM query string | 186 |

**4,895 of those came from CSV upload** (most recent 5 Sept 18:26); only 36
arrived via the API, and none since 2 Sept. So the CSV path is where this
belongs, exactly as Himanshu scoped it.

It is not only cosmetic: the lead code is what decides a lead's **Data Calling
Type** through the Manage Lead Codes mapping. A code with a slash matches no
mapping, so all 4,931 fall through to `NA` and are never prioritised properly.
This is very likely the bulk of the "402 unmapped lead codes" item below.

* New `LEAD_CODE_PATTERN` (`/^[A-Za-z0-9_]+$/`) and `leadCodeError()` in
  `lib/csv-parser.ts` — one rule, exported, so the browser and the server cannot
  drift. The message names the offending characters, because someone fixing a
  5,000-row file needs to know it was the slash.
* Wired into `validateRowDetailed` (browser) **and** the per-row `errs` array in
  `app/api/upload/route.ts` (server). The server copy is the one that matters —
  the browser check is bypassable by posting to the route directly.
* **A blank code stays allowed.** Plenty of legitimate rows carry none and
  making it mandatory would break uploads that work today; it is the malformed
  code that is refused. Say the word if it should be required.
* Rejection is **per row**, matching every other validation on this upload: the
  bad row is flagged red in the preview, excluded from what is sent, counted in
  the error total and written to the downloadable result CSV. The rest of the
  file still loads.

Files: `lib/csv-parser.ts`, `app/api/upload/route.ts`. No schema change, no
migration.

Verified: `tsc --noEmit` clean; all three of Himanshu's invalid examples plus the
real production values and eight more edge cases (`MN 100`, `RT-202`, `sg.api`,
`KG100!`, `a@b`) are rejected, and `Utm100 · sg · krs · nmn · MN_100 · RT_202 ·
KG100 · _ · 100 · blank` are accepted; `/api/upload` and the operations page
both compile and answer.

**Two things deliberately NOT done — both need a decision:**

1. **The 4,931 existing leads are untouched.** This stops new ones only. Cleaning
   them needs a rule for turning `kollegeapply/bm101/API` into `bm101`, which is
   a data decision, not a code one.
2. **`/api/v1/leads` still accepts malformed codes.** Applying the same rule
   there would *reject the lead outright* and the upstream system would lose it —
   a far worse outcome than failing a CSV row somebody can fix and re-upload.
   The right fix on that path is to normalise the tracking string down to the
   code, not to refuse it. Worth raising with whoever owns the lead source.


**Three things are open, none of them a deploy:**

1. **Duplicate feedback options** — `Callback` / `Call Back` and
   `Not Intrested` / `Not Interested`. Agents split one outcome across two
   buttons and the College-wise report shows both columns, because dropping
   either would stop the row adding up. Merging is a data decision: which label
   survives, and where the existing follow-ups move.
2. **The missed-call backfill has not been run** — 638 abandoned calls show no
   agent; 572 resolve from the sticky tag in the stored payload.
3. **The 402 production lead codes are still unmapped**, so newly ingested leads
   read `NA` for Data Calling Type.

**Left alone by decision, not omission:** Paid Apps credits the lead's current
owner; Talktime counts unanswered calls; deleting a lead wipes both feedback
tables; deactivating an agent hides their past figures. Each is described where
it was found, further down.

---

---

## 3. Shipped on 2026-09-05 (`a91fba4`)

### A missed call is not a day at work

Himanshu, on the 4 Sept Caller-wise report: *"Yesterday Shivam Rajput was absent
and not checked in but on the Caller wise report sent yesterday his targets are
there and other people who was also absent, their targets was correct (0)."*

He was right, and the absence rule shipped in `2425daf` was only half-built.
`activeDaysByAgent` counted a day as worked if the agent had a follow-up **or any
CallLog row**. Shivam had 22 CallLog rows on 4 Sept — every one `callType =
'inbound'`, campaign `sticky100205`, **zero talktime, zero answered**, spread
08:35 to 22:44. They were calls that arrived for his sticky seat while he was
away. A phone ringing at an empty desk was being counted as a day at work, so he
drew a full 300-call target while Kamaleswar Ghosh and Zaid Sultan — who had no
CallLog rows at all — correctly drew zero.

**The evidence, measured on production for 4 Sept.** All fourteen present agents
checked in, logged follow-ups AND made outbound calls. All three absentees had
no check-in, no follow-ups and no outbound calls. Shivam differed from the other
two by exactly one thing: missed inbound calls.

Two changes to `activeDaysByAgent`, so a day now counts on the union of three
signals:

1. **An inbound call only counts when it was answered** (`callType <> 'inbound'
   OR talkTimeSeconds > 0`). Outbound always counts, answered or not — placing
   the call is the work. Across the whole database every one of the 1,887
   inbound rows has zero talktime, so in this dialer inbound simply means missed;
   the talktime clause stays in case that ever changes. Only two callTypes exist,
   `inbound` and `outbound`.
2. **A check-in counts as a day worked — but only if it carries an hour of
   active time** (`REAL_SHIFT_ACTIVE_SECONDS`). This closes the hole the first
   fix opened: an agent who turns up and produces nothing would otherwise be
   "absent" and escape their target entirely. Check-in cannot be the only signal
   either — of the 239 days with real work, **78 carry no check-in**.

   **The hour matters, and the first cut of this had it wrong.** A bare
   check-in was counted at first, and every single check-in-with-no-work day on
   the database — all 7 — turns out to be a sub-10-minute login from
   attendance's first ten days, people opening the new feature to see what it
   did: median 1 active minute, maximum 7. Counting them took Kamaleswar Ghosh's
   Overall achievement from 91% to 68% on the strength of a five-minute session
   on 5 August, a day he never worked. The separation is unambiguous — days with
   real work run to a median of 353 active minutes and a maximum of 449 — so an
   hour sits far above the noise and far below any real shift. The threshold
   gates the check-in signal only: a genuine working day with the CRM tab shut
   still counts through the work branches, which is why days with real work show
   a minimum of 0 active minutes and are untouched by it.

**Impact, measured.** Fourteen of seventeen agents keep their day count. Shivam
Rajput drops from 16 all-time working days to 9 — he had been credited with seven
days he never worked — Yash −3, Harsh −2, Pradyumna −1. Nobody gains a day.
Overall percentages tighten to a believable 54–91% band, with Shivam moving 45%
to 75% and Kamaleswar unchanged at 91%.

For 4 Sept the Caller-wise Total becomes 300 x **14** present agents = 4,200
against 4,385 dialled — **104%**, where the mail that went out said 84% and the
half-built rule would have said 97%.

Files: `lib/reports.ts` only. No schema change, no migration, nothing to run on
the database.

Verified before the deploy: `tsc --noEmit` clean; `activeDaysByAgent` runs in
both its bounded and unbounded forms; and against production the rule returns 0
worked days for all three of 4 Sept's absentees and exactly 1 for each of the
fourteen present, with no agent gaining a day from a trial login.

Verified after: commit `a91fba4`, pm2 online, `/login` 200 public and local, and
**not one new error line**. Shipped at 17:15 IST, three hours before the 20:30
send, so the 5 Sept mail is the first to carry it. **Still not seen in an
inbox** — check that Shivam Rajput's target is 0 on any day he only has missed
inbound calls, and that the Caller-wise Total divides by the present headcount.

---

## 4. Shipped on 2026-09-04 — two releases (`a60a19f`, `2425daf`)

### Second release (`2425daf`)

### Absent agents carry no target

Himanshu, on the 4 Sept Caller-wise report: *"the Dialed Calls – Target,
Connected Calls – Target, Hot Leads – Target, Warm Leads – Target, Paid Apps –
Target, Talktime – Target for all the absent agents should be 0. This target is
creating descripency."*

The Total row multiplied each per-agent target by the whole roster: dialled
target 5,100 = 300 x 17 agents, when two of those seventeen had recorded nothing
at all. The floor read **4,260 / 5,100 = 84%** where the fifteen people who
actually turned up had done **4,260 / 4,500 = 95%**. Eleven points of pure
arithmetic error, on every target column at once.

**The trap, and why the obvious one-line fix would have been much worse.**
`kpiScore` returns the FULL points when `target <= 0` (`lib/kpi.ts:118`), and
every percentage helper reads a zero target as "none expected, so met" and
prints 100%. Zeroing an absent agent's target and stopping there would have
handed them a perfect score on every KPI. So absence has to zero the target, the
percentage, the points and their own Max Score together.

New `lib/kpi-absence.ts` (Prisma-free) holds the whole rule — `isAbsent`,
`presentCount`, `targetForAgent`, `scoreForAgent`, `maxScoreForAgent`, `pctOf`,
`pctForTeam`, `pctForAgent` — because there are **four** renderers that must
agree: the email HTML, the email CSV, the KPI page table and the page's CSV
export. Four copies of a conditional is three chances to forget it.

* **Absent = zero Working Days**, i.e. no follow-up and no dialer call in the
  window. Verified against production for 4 Sept: Kamaleswar Ghosh and Zaid
  Sultan have 0 — exactly the two rows Himanshu pointed at. **Shivam Rajput has
  1 working day and 0 dialled, so he is present and keeps his full 300 target.**
  That distinction is the point: a bad day is not an absent day, and the report
  must not hide it.
* An absent agent's row: every target 0, every % `0%`, every points 0, Max Score
  0, Score % `0%`, Grade Unsatisfactory, row shaded end to end — unchanged from
  today, so absence stays the thing you can find by scanning.
* Total row: per-agent target x the **present** headcount, and Max Score x the
  same. 300 x 15 = 4,500.
* The KPI page now shows a **Working** column (reading "absent" for zero) so a
  zeroed target explains itself on screen, and its CSV gained Working Days and
  Date of Joining — the same seven identity columns as the email, so the
  download and the mail can be laid side by side.
* `/api/kpi/targets` returns `workingDays` per agent and applies `scoreForAgent`
  server-side, so the table, the export and the email cannot disagree about
  somebody who was not there.

**Two bugs the first render caught, both now fixed** — worth recording because
neither would have shown up on production data:

1. With *every* agent absent the Total row printed **100%** — the same
   zero-target trap one level up, since the team's target was then zero. Hence
   `pctForTeam`, which returns blank when nobody was present. This is what a
   Sunday report or a Daily report run before the floor starts would have shown.
2. Absent rows printed a blank Max Score where the footer said 0, which stopped
   the column visibly summing to the Total.

Files: `lib/kpi-absence.ts` (new), `lib/email-reports.ts`,
`app/api/kpi/targets/route.ts`, `app/dashboard/super-admin/kpi/page.tsx`. No
schema change, no migration, nothing to run on the database.

Verified before the deploy: `tsc --noEmit` clean; the email renders with absent
rows at 0 target / 0% / 0 pts / Unsatisfactory and the all-absent Total blank
rather than 100%; `/api/kpi/targets` and the KPI page both compile and answer.

**NOT YET SEEN AGAINST PRODUCTION NUMBERS.** Both report rules are DAILY at
20:30 IST and had not run when this shipped, so the 20:30 send on 4 Sept is the
first mail carrying any of it. What to check on it: the Caller-wise dialled
Total should read 300 x (17 - absent) rather than 300 x 17, and its Total %
should jump by roughly ten points. Kamaleswar Ghosh and Zaid Sultan were the
absent pair on 4 Sept; Shivam Rajput was present on nothing achieved and must
still show a target of 300.

### "Your performance" — one day, achieved against target

Himanshu: *"Now I want to show only the daily report, not yesterday, not this
week, not this month. The report should show the Achieved vs target, with score
and grade which we have used in all reports."*

The agent-facing mail was a four-row table — Today / Yesterday / This week /
This month — of bare activity counts (Dialled, Connected, Not connected,
Applications, Admissions, Avg talktime) with a single `Score` column and **no
targets at all**. An agent could not tell from it whether they had hit their
number.

It is now one table for the day, one row per KPI — **KPI / Achieved / Target /
Achieved %** — with a single black `Grade` row at the foot carrying the grade in
its band colour. Points are computed but not shown, and there is no Score %
line: *"remove paid apps row from this report and Points earned. Just give the
grade."*

* Built by new `buildAgentDailyPerformance()`, which reads the DAILY targets and
  points from KPI Targets and runs `computeKpiActual` + `kpiScore` — the same two
  functions the Caller-wise report and the KPI page use. So an agent's own mail
  and their row in the management report agree by construction rather than by
  coincidence — with the one deliberate exception below. Worked example from
  4 Sept: Ankul Singh 322/300 = 8 pts, 133/120 = 8 pts, Hot 0/2, Warm 0/2,
  Talktime 202/180 = 13 pts, **29 / 43 = 67%, Good**.
* **Only KPIs with a daily target appear.** Every row is Achieved vs Target, so a
  KPI with nothing to hit has nothing to say. That drops Not connected,
  Applications, Admissions and Avg talktime, none of which is a KPI with a daily
  target here. If Himanshu wants them back they belong on a separate activity
  line, not in a target table — offer it, do not assume it.
* **Paid Apps is excluded from this report AND from its grade**, via
  `AGENT_MAIL_EXCLUDED_KPIS` in `lib/email-reports.ts` (matched on name, so a
  rename in Manage KPIs means updating it). Asked for explicitly, and Himanshu
  chose to drop it from the grade rather than leave the grade resting on a row
  the agent cannot see. So this report scores out of **43** where the management
  reports score out of 50.

  **⚠ That divergence is deliberate — do not "fix" it.** An agent's grade on
  their own mail will not match their grade on the Caller-wise report: Paid Apps
  is almost always zero and worth 7 points, so it drags the management figure
  down. Someone on 23 points grades **Good** here (23/43 = 53%) and **Needs
  Improvement** there (23/50 = 46%). Expect the question, and the answer is that
  the two reports are asked to measure different things.
* Applies the absence rule from `lib/kpi-absence.ts`, so an absent agent's own
  mail shows the same zeroed targets as the management reports. It also says so
  in words — "No calling activity was recorded for you on this day, so no target
  was applied" — because this mail goes to the person themselves and a row of
  zeroes with no explanation reads like a fault in the report.
* Its own footer, explaining targets, part-credit for points and the grade
  bands. `REPORT_FOOTER` is left alone: the Team summary still sends four windows
  and still needs the old wording.
* **The Team summary is deliberately unchanged** — `buildAgentBlocks`,
  `agentSection` and `toCsv` still render its four windows for management. Only
  the per-agent mail changed.
* Four times cheaper per agent: six `computeKpiActual` calls instead of the
  twenty-four the four-window version made, which recomputed the scoreboard for
  every window.

Files: `lib/email-reports.ts`, `lib/email-runner.ts`. No schema change, no
migration, nothing to run on the database.

Verified: `tsc --noEmit` clean; the mail renders with the greeting, the four-column
KPI table with Paid Apps absent, the single Grade row in its band colour and the
new footer; the exclusion arithmetic checks out (local points drop from 40 to 30
with Paid Apps out, production 50 to 43); `/api/cron/email-reports` compiles.
**Rendered only against the local database, where every agent is absent** — the
populated case is verified arithmetically against the 4 Sept Caller-wise figures
above. The 20:30 IST send on 4 Sept is the first real one; Ankul Singh should
come out Good.

---

### First release (`a60a19f`)

### Overall block: real percentages instead of dashes

Himanshu asked why the Overall block printed `—` in every Achieved %, Overall
Scoring and Grade cell, then chose to have it **scored on the days each agent
actually worked**.

Every percentage in this report is `achieved / (mandate x agent-days)`. Daily
has 1 day, Weekly 6, Monthly the 1st-to-today; Overall is unbounded, so it had
no day count and printed a dash rather than invent one. It now divides by the
days each agent personally worked, and the Overall total by the sum of those.

Files: `lib/reports.ts`, `lib/email-reports.ts`. No schema change, no migration,
nothing run on the database — so no backup was taken, there being nothing this
release could damage. Shipped as a plain build-and-restart, 12m07s.

* New `activeDaysByAgent()` counts IST days on which an agent logged a follow-up
  **or** the dialer recorded a call — the union, because dialling and leaving no
  feedback is common (Shivam Rajput: 8 feedback days, 11 call-log days, 15 in
  union). Reads `FEEDBACK_HISTORY`, so archived follow-ups still count. 84 ms
  unbounded on production, run four times per report.
* `pctNum`/`line`/`metrics` now take **agent-days** instead of `(days, people)`.
  Identical arithmetic for bounded windows — `days x activeEmployees` — so
  Daily, Weekly and Monthly are unchanged to the digit. Verified: Weekly 9797 /
  (300 x 6 x 10) = 54%, Monthly 11497 / (300 x 3 x 16) = 80%, both matching the
  mail sent 3 Sept.
* **Working Days now counts days worked, not check-ins**, in both the Overall
  Calling and Caller-wise reports. This is a deliberate change to a column
  Himanshu had specified as check-in-based, and he has been told. The reason:
  check-in only began 4 Aug 2026 and was skipped most days until the attendance
  gate shipped, so the column was reporting 10 for an agent who worked 25 days —
  wrong on its own terms, and unusable as a divisor (it would have scored Yash
  Sharma at 167% instead of 64%). The gate makes the two converge from here on.
  `workingDaysByAgent()` was deleted so nobody reaches for it by name.
* An agent with **zero** days worked still shows `—` in Overall: no days worked
  means no target, and 0% would read as a failure rather than an absence. No
  production agent is in that state — the lowest is Kamaleswar Ghosh on 3 days.
* Expected Overall dialled figures on production: Yash 64%, Harsh 64%, Mann 64%,
  Nisha 66%, Pradyumna 62%, Zaid 75%, Shubham 64%, Shivam 45%, Naman 65%, Aryan
  54%, Saurabh 71%, Sachin 86%, Priyanka 68%, Ankul 65%, Shahnawaz 64%, Prashant
  63%, Kamaleswar 91%; Overall total 39,398 / (300 x 205) = 64%.

Verified before the deploy: `tsc --noEmit` clean, and both
`buildOverallCallingEmail` and `buildAllReportsEmail` render against the local
database with the Overall rows and Overall Total carrying percentages and
grades. Verified after: deployed commit `a60a19f`, pm2 online, `/login` 200
publicly. **The first mail carrying real Overall percentages has not gone out
yet — check the figures above against it when it does.**

---

## 5. Shipped on 2026-09-03 (`3662b5f`)

Deployed 04:26 UTC / 09:56 IST, after a verified `pg_dump`
(`~/backups/crm-20260903-041338.sql.gz`, 8.4 MB, `gunzip -t` clean). One
`ALTER TABLE … ADD COLUMN` — plain, so wrapped in a transaction — run before the
code: `DropdownOption.collegeClientType`.

Verified after: deployed commit `3662b5f`, pm2 online, the regenerated client
carries the column, `migrate diff` clean apart from the known `Lead.id` line,
ownership check empty, `collegeClientType` in 8 built files and *Non Client* in
10, `/login` 200 publicly, error log flat.

**Not yet exercised on production:** no college has a Client Type set — all 36
read NA, which is correct for a fresh column. The retroactive behaviour was
proven locally (85 existing leads flipped off NA the moment one college was
marked), but nobody has set a real value yet, so it has not been *seen* live.
Setting one is Himanshu's call — which colleges are clients is a business fact,
not something to guess at on production.

### Client Type on the college, shown against every lead

`prisma/schema.prisma`, `lib/college-attributes.ts`,
`lib/college-client-type.ts` (new), the dropdown-options API,
`components/admin/dropdown-options-manager.tsx`, the leads list and export, the
All Leads table.

**⚠ Needs DDL — the easy kind:**

```sql
ALTER TABLE "DropdownOption" ADD COLUMN IF NOT EXISTS "collegeClientType" TEXT;
```

Plain `ADD COLUMN`: transaction-safe, and it inherits the table's grants, so no
`OWNER TO crm`. Run it before the code — the regenerated client selects the
column.

Manage Colleges gains a **Client Type** dropdown beside Deal Type, offering
*Client* and *Non Client*. All Leads shows it immediately after College, and a
college with nothing set reads **NA**.

**It is read live from the college, NOT copied onto the lead** — and that is the
whole point. Zone and Deal Type are stamped on at ingest, so setting them later
only affects new leads. Himanshu's requirement was the opposite: *"When added NA
will be changed to the respective value"*, meaning existing leads too. So the
lead carries no Client Type column at all; the list resolves it per request from
a lookup of the 36 colleges, which is one small query.

Matching is on a trimmed, lower-cased name, because `Lead.college` is free text
arriving from uploads and the API while the college list is curated — `"LPU "`
and `"lpu"` both have to find the row stored as `LPU`.

The values are a fixed pair in `lib/college-attributes.ts` rather than a new
Manage Dropdowns type, matching how Zone and Deal Type are already handled there
and keeping the form and the server validation from drifting apart.

**Verified end to end** on a running server: with nothing set, all 100 leads on
a page read `NA`; marking *Goa Institute of Management* as Client through the
admin API flipped **85 existing leads** to `Client` in the same breath while the
other 15 stayed `NA`; the column sits at position 11, between College and KAPP
College ID; and the form offers exactly *— Not set — | Client | Non Client*.
The lookup itself was checked against `NA` → `Client` → `Non Client` → `NA`,
including a padded, wrongly-cased name and a college that does not exist.

It downloads too — the leads CSV gains a Client Type column filled from the same
lookup, so the file cannot disagree with the screen.

**A trap worth recording:** the dev server holds the Prisma client it started
with, so both APIs returned 500 (`Unknown field collegeClientType`) until it was
restarted after `prisma generate`. Same symptom as the `punchInIp` column. On
production the deploy regenerates and restarts, so it does not arise there — but
it costs ten confusing minutes locally every time.

---

**Nothing else is waiting.**

**Four things are open, none of them a deploy:**

1. **Connected Calls still counts follow-up rows**, so the Caller-wise report
   sits about 1% above every other report. One `UPDATE`, no deploy — but it
   lowers everyone's Connected Calls and that KPI is worth 8 points, so it wants
   Himanshu's word first:
   ```sql
   UPDATE "KpiDefinition" SET source = 'FEEDBACK_LEADS_LATEST' WHERE name = 'Connected Calls';
   ```
2. **Duplicate feedback options.** `Callback` and `Call Back` are two separate
   options, as are `Not Intrested` and `Not Interested` — agents are splitting
   one outcome across two buttons. The College-wise report now shows both
   columns side by side, because dropping either would stop the row adding up.
   Merging each pair is a data decision: which label survives, and where the
   existing follow-ups move.
3. **The missed-call backfill has not been run.** 638 abandoned calls show no
   agent; 572 resolve from the sticky tag in the stored payload.
4. **The 402 production lead codes are still unmapped**, so newly ingested leads
   read `NA` for Data Calling Type.

**Left alone by decision, not omission:** Paid Apps credits the lead's current
owner; Talktime counts unanswered calls; deleting a lead wipes both feedback
tables; deactivating an agent hides their past figures. Each is described where
it was found, further down.

---



## 6. Shipped on 2026-09-02 — two releases (`808a0f8`, `3e05581`)

`808a0f8` at 11:53 UTC carried the archive-history fix and the Overall Calling
rework, and needed two `CREATE INDEX` statements on `LeadFeedbackArchive`, run
before the code. `3e05581` at 14:04 UTC carried the report column fixes and
needed no DDL. Both followed a verified `pg_dump`.

Verified after each: deployed commit, pm2 online, regenerated client, `migrate
diff` clean apart from the known `Lead.id` line, ownership check empty, every
new string present in the built bundle, `/login` 200 publicly, error log flat.

**The reconciliation promised for the archive fix, run on production:** 31
August returned Harsh Yadav 306 (the email said 306), Aryan Dubey 301 (301),
Priyanka Sharma 200 (200) and Naman Sharma 304 against an emailed 302 — the
page being right and the email short, because 3 of his leads were reassigned at
17:54, three hours before the send.


> **Deploying later today (2 Sept).** Everything in this section goes out in one
> release. Runbook at the bottom of this block; the DDL is three statements, all
> transaction-safe, plus one data `UPDATE` that needs no deploy at all.

### University / College wise — a fixed outcome column order

`lib/reports.ts`, `lib/email-reports.ts`,
`app/dashboard/super-admin/reports/page.tsx`. **Code only, no DDL.**

Outcome columns were ordered by volume, so they reshuffled themselves as the
data moved and two weeks could not be compared side by side. They now follow
the fixed sequence Himanshu set — conversion first (Walk-In, applications,
admissions), then warm interest, then why a call went nowhere, then why a number
was no good — held in `COLLEGE_OUTCOME_ORDER`.

**Three of the names in the brief do not match the CRM's own labels**, and using
the brief's spelling would have produced three empty columns while exiling the
real ones to the end:

| The sheet says | The CRM actually has |
|---|---|
| Call Back | `Callback` |
| Call Disconnected | `Call Disconnect` |
| Switched Off | `Switch Off` |

Confirmed against production for 24 Aug, the date in the reference screenshot:
`Call Disconnect` 267, `Switch Off` 85, `Callback` 30 — matching the sheet's
figures for those columns exactly, which is what proves the mapping. Matching is
now case- and punctuation-insensitive, so renaming an option later keeps its
column in position rather than silently moving it to the end.

**Listed columns always appear, even at zero**, because that is the point of a
fixed sequence — the sheet carries "Cold 0" and "Tried 5 Time 0", and a column
that vanishes on a quiet day defeats the comparison. Unlisted outcomes still
appear, at the end, most-used first: today that is *Already Admission Done in
same University* and *Already Application Done in same University*.

**A bug found while testing this, worth recording.** The first version kept one
label per position. This database carries both `Callback` and `Call Back`, which
normalise to the same key, so one silently overwrote the other — and its leads
then counted toward Dialed while belonging to no outcome column. The row stopped
adding up: 348 against a Dialed total of 351. Both labels are now kept, adjacent
and in the right region. Production has no such duplicate today, so it would
not have shown there immediately, which is exactly why it was worth catching.

Verified with one lead per outcome at a deliberately distinct count: 25 listed
columns in the exact order given, no column repeated, and the sum of every
outcome column equal to Dialed both on the totals row **and on every college
row**.

### Overall Calling and Caller-wise — identity columns, black totals, tighter columns

`lib/reports.ts`, `lib/email-reports.ts`, `lib/attendance.ts`.
**Code only, no DDL.**

Three fixes from Himanshu on 2 Sept:

**1. Black total rows are black end to end.** The band colour was still filling
their Overall Scoring and Grade cells, so a floor total wore a colour that reads
as one person's grade — and it broke the line visually. `metrics()` takes a
`plain` flag now, set only on total rows.

**2. Working Days and Date of Joining sit after the employee name**, in the
Overall Calling Report and the Caller-wise report.

Working Days is counted from the agent's **own check-ins** inside the window,
not from the calendar and not from the roster: `Attendance.date` is already the
IST day key as a plain string, so it is a straight string range with no timezone
arithmetic, and the table's unique constraint on (user, date) means counting
rows is counting days. A six-day window in which someone checked in three times
reads as 3. Overall — which has no bounded window — counts from the first shift
ever recorded.

`workingDaysByAgent` lives in `lib/reports.ts`, not `lib/attendance.ts`. It
takes `db` as an argument and needs no singleton, and putting it in the
attendance module dragged that file's `@/lib/prisma` alias import into the whole
reporting import graph for nothing.

**3. Columns hug their content.** Both Overall Calling tables were
`min-width:100%`, which with a dozen columns stretched them to fill the mail and
left "221" floating in a very wide cell. They are `width:auto` now — the detail
table measures 1,033px of actual content instead of whatever the window is,
which is the treatment the university-wise report already had.

**Caught while doing it:** padding the summary out to the detail table's 12
columns left **two empty columns** sitting in the middle of it. The summary's
rows are windows, not people, so it has no Working Days or Date of Joining and
now spans its own 10 columns. Each table sizes itself rather than matching the
other.

Verified on rendered output: every summary row spans exactly 10 columns and the
detail 12 (11 under a rowspan, which is correct), no black row carries a band
colour, and the identity columns read
`Matrix | Employee Name | Working Days | Date of Joining | …` with each mandate
sitting over the pair of columns it governs — in the CSV as well as the HTML,
where the mandate strip's blanks had to be moved to match.

### Summary Report reordered, and grading on the Caller-wise report

`lib/reports.ts`, `lib/email-reports.ts`. **Code only, no DDL.**

**The Summary Report now leads with the headline**, in the order from the sheet:

| row | fill |
|---|---|
| `Calling Summary Report` (title, spans both) | yellow |
| **Total** | orange |
| **Count of Team Members** | cream |
| University/Institution Count | orange |
| the outcome rows | white |

Total moved from the bottom to the top, and **Count of Team Members** is new:
agents who logged at least one follow-up in the window, not the size of the
roster. It is the figure that makes the total legible — 4,261 leads means one
thing across 14 people and quite another across 6.

Counted off the follow-ups directly rather than the per-lead CTE the rest of the
table uses: that one keeps one row per LEAD, so an agent whose every lead was
later touched by someone else would vanish from it despite having worked.

**The Caller-wise report now carries the same grade colours** as the Overall
Calling Report, from the same `gradeColour` — Score % and Grade both filled by
band.

**With one exception Himanshu asked for: an Unsatisfactory agent is shaded end
to end.** Every other band tints only the two score cells; below 30% the whole
row goes red. The reason is the table's width — 33 columns that scroll
sideways, so a tint on the far right is exactly what a reader misses. Someone
who needs attention should be findable by scanning down the page.

Verified on rendered output: a Needs-Improvement row has 2 of 33 cells tinted,
an Unsatisfactory row has 33 of 33, and the Summary Report renders in the order
above with the outcome rows still plain white.

### Overall Calling Report — reworked

`lib/reports.ts`, `lib/email-reports.ts`, `lib/kpi-grade.ts`.
**Code only, no DDL.**

Four changes Himanshu asked for on 2 Sept:

**1. Weekly is now the WHOLE of last week, Monday to Saturday.** It was
Monday-to-today, a window that moved every day. On a Wednesday it now reports
the previous Monday-to-Saturday — settled, six days, never changes again.
Sunday is excluded because the floor does not work it; counting it would divide
a full week's effort by seven days of mandate. Verified on 2 Sept (a Wednesday):
the window came out **24 Aug → 29 Aug, days = 6**.

**2. Monthly is unchanged** — 1st of the month to today, which is what it
already did. Verified: 1 Sept → 2 Sept, days = 2.

**3. Two new columns after the Talktime mandate**, in both the summary and the
detail table, under a "Scoring" band in the yellow strip:

- **Overall Scoring** = (Dialled % + Connected % + Talktime %) / 3
- **Grade** — the same bands as the Agent wise report, from the shared
  `gradeFor`

Both cells are filled with the band's colour, and the colour lives in
`lib/kpi-grade.ts` right beside the thresholds it depends on — a colour and a
grade disagreeing about where 70% sits would be worse than neither:

| Band | Score % | Fill |
|---|---|---|
| Excellent | 85 and above | `#b6d8a8` |
| Very Good | 70 – 85 | `#9fc5e8` |
| Good | 50 – 70 | `#ffe59a` |
| Needs Improvement | 30 – 50 | `#f6b26b` |
| Unsatisfactory | below 30 | `#ea9999` |

On the black total rows the band colour wins and the text flips back to dark —
a colour meaning "Unsatisfactory" is no use invisible on black.

**Overall Scoring needs all three percentages.** A missing mandate, or the
Overall window which has no day count, leaves it and the Grade blank rather than
dividing two numbers by three.

**It is deliberately not capped at 100%.** Talktime alone already runs to 127%
on real data, and capping would hide over-achievement. Anything above 85 grades
Excellent either way.

**4. The Grand Total (A + B + C) row is gone**, from the table and the CSV, and
with it `grandTotal` in the data layer and the now-unused `GRAND_BG`. It summed
overlapping windows and was never a count of distinct work.

The table is 10 columns wide now; every banner row's span was widened to match
and checked — the rendered HTML has rows of 1, 2, 6 and 9 cells that all
reconcile to 10 columns.

Verified end to end on rendered output with five agents seeded across the bands:
all five colours appear, on cells 8 and 9 only, and the Overall row is untinted
with a blank grade.

### RUNBOOK — the whole release in order

**1. Back up.**

```
F=~/backups/crm-$(date +%Y%m%d-%H%M%S).sql.gz
sudo -u postgres pg_dump counselling_crm | gzip > "$F"; chmod 600 "$F"; gunzip -t "$F"
```

**2. DDL, before the code.** All plain and transaction-safe, so one wrapped run:

```sql
BEGIN;
CREATE INDEX IF NOT EXISTS "LeadFeedbackArchive_agentId_createdAt_idx"
  ON "LeadFeedbackArchive" ("agentId", "createdAt");
CREATE INDEX IF NOT EXISTS "LeadFeedbackArchive_createdAt_idx"
  ON "LeadFeedbackArchive" ("createdAt");
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "punchInIp" TEXT;
COMMIT;
```

`ADD COLUMN` and `CREATE INDEX` both inherit the table's grants, so no
`OWNER TO crm` is needed — that only bites on `CREATE TABLE`.

**3. Commit, push, `gh workflow run "Deploy to AWS" --ref main`.** ~10 minutes.

**4. The Connected Calls fix — a data change, no deploy, run it any time:**

```sql
UPDATE "KpiDefinition"
SET source = 'FEEDBACK_LEADS_LATEST'
WHERE name = 'Connected Calls';
```

This is the last KPI still counting follow-up **rows** instead of **leads**. It
is why the Caller-wise report shows a different Connected total from every other
report — 1,353 vs 1,339 on 31 Aug. `FEEDBACK_LEADS_LATEST` is exactly what
`buildAgentReport` does, so the two match permanently after it. **It lowers
everyone's Connected Calls by about 1%**, and that KPI is worth 8 points, so
scores shift slightly. Tell Himanshu before running it.

**5. Verify after.** Deployed commit, pm2 online, regenerated client carries
`punchInIp`, `migrate diff` shows only the known `Lead.id` line, ownership check
empty, `/login` 200, error log not growing. Then re-run the 31 August
reconciliation and confirm the page and the email agree — that is the whole
point of this release and it should be shown, not asserted.

### What this release actually fixes, and what it does not

Established by measurement on production, 2 Sept:

- **Fixed:** a reassignment no longer erases the previous agent's history. This
  was corrupting figures *the same day*, not just retrospectively — Naman
  Sharma had 3 leads reassigned at **17:54 on 31 Aug**, so the 20:30 email
  already reported 302 when the true figure was 304, and by 2 Sept the page
  showed 243. After this release both surfaces read 304, permanently.
- **Correction to an earlier note in this file:** the emailed figure is *not* a
  reliable record of the day. It is only accurate for reassignments that happen
  after it sends. Do not treat the mail as the source of truth.
- **Withdrawn:** an earlier suggestion to move the 20:30 send to 23:45. It was
  based on a misread query (a `12:00 UTC` cutoff is 17:30 IST, not 20:30). Work
  stops at 20:00 — the 19:00 hour carries 552 leads, 20:00 carries 4, 21:00
  carries 1, and exactly **one** lead floor-wide was logged after the send on
  31 Aug. Leave both rules at 20:30.

**Still open after this release** — none are fixed by deploying:

| Issue | Effect | Fix |
|---|---|---|
| Connected Calls counts rows | Caller-wise ~1% above every other report | step 4 above, one `UPDATE` |
| Paid Apps credits the lead's **current** owner | drifts on reassignment; 2 of 11 approved receipts already credited elsewhere | switch to `uploadedById` — changes who gets credit, needs Himanshu's call |
| Talktime counts unanswered calls | ~45% of it is ring/wrap time at ~24s a call | add `connected: true`; would roughly halve the figure, so the 120 target needs revisiting together |
| Deleting a lead wipes **both** feedback tables | history gone for good; 10 leads deleted so far, most recently 24 Aug | soft-delete instead of `onDelete: Cascade` — a real design change |
| Deactivating an agent hides their past figures | the agent list filters `isActive`, so a leaver vanishes from closed months | include inactive agents when the window is historical |

The last two have not bitten yet — zero orphaned feedback rows, and nobody who
worked on 31 Aug is currently inactive — but both are live risks.


### Report email tables are plain white

`lib/email-reports.ts`. **Code only, no DDL.**

The alternating white/cream banding is gone from every table body — Himanshu
asked for no colour on the rows. The `stripe()` helper is deleted rather than
neutered, so nothing can quietly reintroduce it, and all six tables lost it
together: team, agent, feedback summary, college wise, agent wise, and both
Overall Calling tables.

Colour is left only where it is structural, not decorative: the amber and orange
column headers, the yellow date/mandate strip, the black per-block totals and
the blue grand total. Two cream cells also remain — the feedback summary's
**Total** row and the two report title banners — because they separate a total
from the rows it sums. Easy to strip as well if he wants those white too.

Verified on rendered output: in the feedback summary 11 of 13 rows are pure
white (header + Total are the exceptions), and in the Overall Calling mail 24 of
35, with every *data* row white in both.

### ⚠ Performance history no longer disappears when a lead is reassigned

`lib/feedback-history.ts` (new), `lib/kpi.ts`, `lib/reports.ts`,
`prisma/schema.prisma`, the KPI Targets page.

**Needs DDL — two indexes. Plain `CREATE INDEX`, transaction-safe:**

```sql
CREATE INDEX IF NOT EXISTS "LeadFeedbackArchive_agentId_createdAt_idx"
  ON "LeadFeedbackArchive" ("agentId", "createdAt");
CREATE INDEX IF NOT EXISTS "LeadFeedbackArchive_createdAt_idx"
  ON "LeadFeedbackArchive" ("createdAt");
```

**The bug.** Reassigning a lead with "reset feedbacks" moves the outgoing
agent's follow-ups out of `LeadFeedback` into `LeadFeedbackArchive` and deletes
the live rows, so the new agent starts clean. That part is deliberate. But every
performance figure read only the live table — so the moment a lead moved, the
previous agent's work vanished from **past** dates as well.

Himanshu caught it: the 31 Aug report emailed Harsh Yadav **306** dialled calls;
after a reassignment the next morning, the same date on the KPI page showed
**248**. The 58 missing leads were in the archive. This was not a corner case —
**16,762 of 47,949 follow-ups, over a third of all history, had already been
moved this way.**

**The fix.** One shared SQL relation, `FEEDBACK_HISTORY`, unions the live and
archived tables, and every feedback-based figure now reads it: the three KPI
sources (`FEEDBACK_COUNT`, `FEEDBACK_LEADS`, `FEEDBACK_LEADS_LATEST`),
`buildAgentReport`, `buildFeedbackBreakdown` and `buildCollegeBreakdown`. One
definition, so a future caller cannot read half the history by accident.

`UNION ALL`, not `UNION`: archiving deletes the live row in the same
transaction, so a follow-up is in exactly one table. Verified on production —
zero rows appear in both — so the distinct sort would cost time for nothing.

The two Prisma `count`/`groupBy` calls became raw SQL, because the union has to
happen in SQL. `feedbackWhere()` is gone with them, replaced by
`feedbackNarrowingSql()` shared with the latest-feedback query.

**Verified against production data** by running the new SQL there: 31 Aug now
returns Harsh Yadav 306 (was 248), Naman Sharma 304 (was 243), Zaid Sultan 309
(was 301), Aryan Dubey 301 (was 295), and Priyanka Sharma unchanged at 200 —
she had no leads reassigned. Then locally end to end: ten follow-ups, four of
them archived exactly as a reset-reassignment does, and every path —
`computeKpiActual`, `buildAgentReport`, the feedback summary and the college
breakdown — returned 10 rather than 6.

**One honest limit worth knowing.** The page now shows the *complete* day,
permanently. A scheduled email is still a snapshot of the moment it was sent —
the 31 Aug report went out at 20:30 IST, so Naman's last two leads of the
evening are on the page (304) but not in that email (302). The page and the
email agree exactly for any day that had closed before the send.

**Still outstanding, and separate:** `RECEIPT_COUNT` (Paid Apps) counts by the
lead's *current* owner rather than who uploaded the receipt, so it still drifts
on reassignment — 2 of 11 approved receipts are already credited elsewhere.
Fixing it means switching to `uploadedById`, which changes who gets the credit,
so it is Himanshu's call rather than a silent change.

**Also fixed here:** on a one-day custom range every KPI column's subtitle read
"live count". The label compared the scaled target to the base, and for one day
`base × 1 == base`. It now asks the source whether it is a snapshot.


**Three things are open, none of them a deploy:**

1. **The missed-call backfill has not been run.**
   `node scripts/backfill-missed-call-agents.js --apply` on the box. 638
   abandoned calls show no agent; 572 resolve from the sticky tag in the stored
   payload.
2. **The 402 production lead codes are still unmapped**, so newly ingested leads
   read `NA` for Data Calling Type.
3. **nginx does not `include proxy_params`**, so `X-Real-IP` is never set. The
   check-in IP works without it — it reads the last `x-forwarded-for` hop, which
   nginx appends and a client cannot forge — but the code prefers `X-Real-IP`
   when present, so adding that one line to
   `/etc/nginx/sites-available/crm` would quietly make it more direct. One line,
   an `nginx -t` and a reload; no deploy.

### ⚠ Deploying during the day costs error lines — and it is NOT the memory

**Corrected 2026-09-04.** I had this wrong for four releases. The theory was
that `next build` eats the box's free memory and the running process then cannot
get a database connection, and the numbers seemed to fit: the two noisy deploys
started under 100 MB free, the four quiet ones over 190 MB.

The `a60a19f` deploy falsified it. I restarted pm2 first specifically to free
memory, went in with **398 MB available** — double the "safe" threshold — and
still collected **1,838 error lines and 62 fresh `P2024`s**, every one a
connection-pool timeout on routine polling: `notifications` 18,
`attendance/heartbeat` 12, `announcements` 10, plus `lead-feedback`,
`users/me/permissions` and `leads/filter-options`. Memory ended the deploy
higher than it started, at 414 MB. The old correlation was coincidental — the
quiet deploys were quiet because fewer agents were online.

The real mechanism is in the error payload, which has said so all along:
**`connection_limit: 3`**. Prisma sizes its pool at physical cores x 2 + 1 and
sees one physical core on this box, so the entire app shares three connections
with a 10-second checkout timeout. Postgres itself allows 100. `next build`
saturates the box for twelve minutes, every query slows, and each polling client
blows its 10-second timeout in turn. It stops dead at the restart — measured
zero new lines across 45 idle seconds afterwards.

**The fix is one line and has NOT been applied — it changes production config
and needs Himanshu's say-so:** add `&connection_limit=10&pool_timeout=20` to
`DATABASE_URL` in `/home/ubuntu/app/.env.local`, then restart. Ten connections
against a server limit of 100 is still conservative, and it would end these
lines whatever the hour. Deploying outside working hours only hides the noise;
it leaves the pool just as narrow under any other load spike.

---

## 7. Shipped on 2026-08-30 (`1134b9e`)

Deployed 11:29 UTC / 17:00 IST. One `ALTER TABLE … ADD COLUMN` — plain, so it
was wrapped in a transaction — run **before** the code, after a verified
`pg_dump` (`~/backups/crm-20260830-111955.sql.gz`, 5.6 MB, `gunzip -t` clean):
`Attendance.punchInIp`. `ADD COLUMN` inherits the table's grants, so no
`OWNER TO crm` was needed; confirmed with `has_column_privilege` afterwards.

Verified after: deployed commit `1134b9e`, pm2 online, the regenerated client
carries the column, `migrate diff` reports only the known `Lead.id` line, the
ownership check returns nothing, every new string is present in the built bundle
(`ATTENDANCE_REQUIRED` in 7 files, `Check in first` in 4, `punchInIp` in 12,
the new grade names in 5), `/login` returns 200 publicly, and the error log
gained zero lines in the 50 seconds after the restart.

**Note on the live picture:** production had **zero attendance rows for today**
at deploy time — which is precisely the problem this release addresses.


### The check-in IP, behind a click in the attendance log

`prisma/schema.prisma`, `lib/client-ip.ts` (new), `lib/attendance.ts`,
`app/api/attendance/punch-in/route.ts`, the Agent Time BreakUp page.

**⚠ Needs DDL — but the easy kind this time:**

```sql
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "punchInIp" TEXT;
```

A plain `ADD COLUMN`: transaction-safe, and it inherits the table's grants, so
no `OWNER TO crm` is needed (that only bites on `CREATE TABLE`). Still run it
before the code — the regenerated client selects the column.

The device IP is recorded **once, at check-in**, and shown in Agent Time
BreakUp behind a small eye button beside the Punch In time. Hidden by default
rather than given a column of its own: it is only looked at when a shift is
being questioned, and a permanent column of addresses would push the numbers
people actually read off the screen — and put everyone's device address in
front of anyone glancing at the report. Clicking reveals it; clicking again
hides it. A shift with nothing recorded reads "no IP", which covers both the
rows that predate this and any check-in where no forwarding header arrived.

**Not refreshed after check-in.** The question this answers is "where was the
shift started from"; a heartbeat-tracked value would only show wherever they
last had the tab open.

**It takes the LAST entry of `x-forwarded-for`, not the first — and that is
deliberate.** The usual advice is "leftmost is the original client", which is
right behind proxies you do not control and wrong here. Production nginx does:

```
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

— "whatever the client sent, plus the address nginx actually saw". So a client
sending its own `X-Forwarded-For: 10.0.0.1` produces
`10.0.0.1, <their real IP>`: the **leftmost is attacker-controlled** and the
rightmost is what our nginx observed. With exactly one hop (nginx → the app on
localhost:3000, which is this deployment) the last entry is both correct and
impossible for the client to forge. Proven: a check-in sent as
`10.0.0.1, 49.36.180.77` stored `49.36.180.77`.

*If a CDN or load balancer is ever put in front of nginx this needs revisiting*
— the last entry would then be nginx's view of that balancer.

**Worth doing on the box, separately (nginx config, not code):** the crm site
does **not** `include proxy_params`, so `X-Real-IP` is never set. The code
already prefers `X-Real-IP` when present, because nginx sets it from
`$remote_addr` and overwrites anything the client sent — the most trustworthy
source. Adding that one line to `/etc/nginx/sites-available/crm` would silently
improve this rather than change behaviour.

Verified: the header parser against twelve cases — nginx's plain chain, a client
forging one leading hop, a client forging three, whitespace, `x-real-ip`
winning when present, loopback (`::1` and `127.0.0.1` → shown as `localhost`,
because "::1" in an attendance log teaches an operator nothing), IPv4-mapped
IPv6, a real IPv6 left alone, no header, an empty header, and a trailing comma
(12/12). Then end to end: the spoofed chain above stored the real address, and
in the log it was absent until the button was clicked, present after, and gone
again on a second click.

---

### No attendance, no calling

`lib/attendance-gate.ts` (new), `lib/attendance-required.ts` (new),
`components/attendance/check-in-required-dialog.tsx` (new), `app/providers.tsx`,
the dialer and feedback API routes, and the four client callers.
**Code only, no DDL.**

An agent who has not marked attendance today cannot place a call or log a
follow-up. Trying either pops a **Check in first** dialog that offers the
check-in inline — their next action is always "punch in", so sending them off to
find the clock is a step for nothing.

**Enforced on the server**, in `/api/dialer/call` and
`/api/leads/[id]/feedback`. A disabled button is a courtesy; the API is what
actually stops someone working off the clock. The refusal carries
`code: ATTENDANCE_REQUIRED` so the browser can tell it from an ordinary 403 —
a permission failure is also a 403 — and open the dialog instead of a toast.

**Three deliberate limits:**

- **Only counselling agents are gated.** A TL or an admin acting on a lead is
  doing something administrative and should not be blocked by their own punch
  clock. Easy to widen if Himanshu wants TLs included.
- **On break still counts as present.** Blocking it would stop an agent taking a
  callback during lunch, and they can end the break themselves anyway.
- **Punched out still counts, and this one is not a preference.** `punch-in`
  returns 409 *"You have already completed your shift for today"* once a shift
  is closed, so blocking a punched-out agent would strand them for the rest of
  the day with no way back in. That is a lockout, not a check. If punched-out
  agents should also be stopped, punch-in has to allow re-opening a shift first.

**A mount gap found while testing.** The dialog first went in the topbar, which
covers `/dashboard/**` — but the standalone lead profile page at
`/leads/[id]/profile` renders without that shell and **has a Call button**, so
an agent there would have got a bare error and no popup. It now mounts once in
`app/providers.tsx`, beside the Toaster, which every route passes through.

**The redundant toast is suppressed.** The first version showed the dialog *and*
a red "Call failed" toast carrying the same sentence — the same message twice,
the second time in a more alarming voice. `failIfAttendanceBlock` now throws a
marked error so each caller's `onError` can stay quiet.

**Verified:**

- Server, through real API calls as an agent with no attendance: add feedback →
  `403 ATTENDANCE_REQUIRED`, place a call → `403 ATTENDANCE_REQUIRED`. After
  punching in, feedback returns `201` and the call gets past the gate and fails
  on a *different* reason (`NO_DIALER_ID`), which is the proof it is no longer
  the blocker. A Super Admin who never punched in is not gated at all.
- Browser, end to end on the profile page that previously had no dialog:
  clicking **Call** opened "Check in first", **Check in now** punched them in
  (status `WORKING`), the dialog closed, and no red toast appeared beside it.

**Not observed directly:** the popup appearing from a *feedback* submit. The
server half is proven above and all three feedback callers use the same
type-checked one-line pattern as the call path, but the drawer's follow-up form
resisted automation — the submit never fired a POST, so there was nothing to
observe. Worth one manual click before this is trusted in front of agents.

---

### Named grades on the Agent wise report

`lib/kpi-grade.ts`, `lib/email-reports.ts`. **Code only, no DDL.**

The Grade column drops the letter bands for the ones Himanshu set:

| Score % | Grade |
|---|---|
| 85 – 100 | Excellent |
| 70 – 85 | Very Good |
| 50 – 70 | Good |
| 30 – 50 | Needs Improvement |
| below 30 | Unsatisfactory |

**The bands as written share their endpoints** — 85 is in both Excellent and
Very Good, 70 in both Very Good and Good, and so on. The higher band takes the
boundary, which is how "85% - 100%" normally reads: exactly 85 is Excellent, 84
is Very Good. Said out loud in the function's comment and in the email footer,
because it is the sort of thing that gets queried later.

One function, `gradeFor`, feeds both the KPI Targets download and the emailed
report, so the two cannot disagree. A KPI that is measured but not scored still
gives a blank rather than a grade.

Verified twice over: every band and every boundary as a direct check
(85/84, 70/69, 50/49, 30/29 — 16 of 16 correct), and then end to end through the
real report, which printed Excellent at 99% and 90%, Very Good at 83% and 75%,
Good at 68% and 63%, Needs Improvement at 37% and 31%, and Unsatisfactory at
19%.

*Local aside, not a code issue:* reaching the top bands locally needed the
Hot Leads, Warm Leads, Paid Apps and Talktime targets parked, because none of
them has data on this machine — Talktime is `NOT_MEASURED` locally while
production uses `CALL_TALKTIME_MINUTES`. All four daily targets were restored
afterwards (300/5, 80/10, 2/5, 2/5, 1/10, 120/5).

---

**Nothing else is waiting.**

**Two operational tasks are still open**, neither of them a deploy:

1. **The missed-call backfill has not been run.**
   `node scripts/backfill-missed-call-agents.js --apply` on the box. 638
   abandoned calls currently show no agent; 572 resolve from the sticky tag in
   the stored payload. Until it runs, only missed calls arriving after the
   27 Aug release show an agent.
2. **The 402 production lead codes are still unmapped**, so newly ingested leads
   read `NA` for Data Calling Type.

### ⚠ Deploying during the day costs ~330 error-log lines, every time

> **Superseded — the memory explanation below is wrong.** The `a60a19f` deploy
> went in with 398 MB free and still produced 1,838 error lines. The cause is
> Prisma's three-connection pool, not the free memory. See §4, "Deploying during
> the day costs error lines — and it is NOT the memory". The counts and
> timings recorded here are still accurate; only the diagnosis was.

This has now happened on **both** of the last two deploys, and it is predictable
rather than a surprise: `next build` takes the box from ~450 MB free down to
under 100 MB, and the *running* process then cannot get a database connection —
`P2024 Timed out fetching a new connection from the connection pool
(connection_limit: 3, timeout: 10)` on `/api/notifications`, with
`JWT_SESSION_ERROR` behind it. It stops the moment pm2 restarts. On 27 Aug and
again on 29 Aug the log grew by roughly 330 lines during the build window and by
zero afterwards.

Nothing is broken by it, but users hitting the CRM during those ~8 minutes get
failed requests. Three ways out, none free, all Himanshu's call:

- **Deploy outside working hours.** Costs nothing, fixes it entirely.
- **Raise `connection_limit`** above 3. Costs memory the box does not have much
  of, and does not help if the build is the thing eating it.
- **Build somewhere other than the box** and ship the artefact. The real fix,
  and the most work.

---

## 8. Shipped on 2026-08-29 (`a510dab`)

Deployed 08:48. Two `ALTER TYPE … ADD VALUE` statements were run standalone, in
their own psql calls under autocommit, **before** the code, after a verified
`pg_dump` (`~/backups/crm-20260829-083701.sql.gz`, 5.3 MB, `gunzip -t` clean):
`EmailReportType.OVERALL_CALLING` and `EmailReportType.ALL_REPORTS`.

Verified after: deployed commit `a510dab`, pm2 `crm` online since 08:48:06, the
regenerated client carries both enum values, `migrate diff` reports only the
known `Lead.id` line, the ownership check returns nothing, `OVERALL_CALLING` and
`ALL_REPORTS` each appear in 7 built files, `/login` returns 200 publicly, and
the error log gained nothing in the 45 seconds after the restart.


### All Reports — every table in one email

`lib/email-reports.ts`, `lib/email-subjects.ts`, `lib/email-runner.ts`,
`prisma/schema.prisma`, `app/api/super-admin/email-rules/route.ts`, the Email
Automation page.

**⚠ Needs DDL — this release now needs TWO enum values, both standalone and
before the code:**

```sql
ALTER TYPE "EmailReportType" ADD VALUE IF NOT EXISTS 'OVERALL_CALLING';
ALTER TYPE "EmailReportType" ADD VALUE IF NOT EXISTS 'ALL_REPORTS';
```

One new "What to send" option sending five tables in one mail, in Himanshu's
order:

| # | Section heading | What it actually is |
|---|---|---|
| 1 | Overall Calling Summary | the calling roll-up by window |
| 2 | Summary Report | **the feedback summary** — leads by outcome |
| 3 | Overall-Report | the calling detail, per agent per window |
| 4 | Caller-wise Report | **the Agent wise report** — the KPI scoreboard |
| 5 | University-Wise Report | the same leads split by college |

**Two of those names were a judgment call.** "Summary Report" and "Caller-wise
Report" do not map to a report by name, so they are read as the feedback summary
and the agent-wise scoreboard. Both are one line to re-point if that is wrong —
the sections are composed from a list.

**Every section is the same markup its own email sends**, not a second
rendering: the builders now return their table alongside their full email, and
the combined mail stitches those together. Verified in the render that section 1
Daily (22 / 19 / 90) equals section 3's "Daily Total A", and section 2's Total of
22 equals section 5's dialled total.

**The subject names the month and changes with it:**
`Overall Call Centre_ Calling Summary Report || August 2026`. Computed rather
than stored — a constant would still say August next February. It is the one
recurring subject that deliberately changes, so **each month starts its own mail
thread**, which is the point; every other report keeps a fixed subject to stay
in one conversation. Checked across a month boundary, a year boundary, and
23:45 IST on the 31st — which would roll to the next month if it were computed
in UTC. An admin-typed subject still overrides it.

**One CSV attachment** carries all five tables, each under its numbered heading.
Splitting the calling report's CSV in two for this briefly dropped the "Overall
Calling Report" title from the *standalone* calling attachment; caught and
restored, and both are asserted now.

---

### Overall Calling Report

`lib/reports.ts`, `lib/email-reports.ts`, `lib/email-runner.ts`,
`lib/email-subjects.ts`, `prisma/schema.prisma`,
`app/api/super-admin/email-rules/route.ts`, the Email Automation page.

**⚠ Needs DDL, the kind that cannot go inside a transaction:**

```sql
ALTER TYPE "EmailReportType" ADD VALUE IF NOT EXISTS 'OVERALL_CALLING';
```

**Standalone, and before the code.** Same rule as the last two enum values.

The sheet Himanshu keeps by hand, as a schedulable email: every agent across
four windows — today, this week so far, this month so far, and all time —
against the daily mandate. Title row, the yellow date/mandate strip, orange
column headers, a Matrix column merged down each block, black per-block totals
(A / B / C) and the blue grand total.

**Where each number comes from:**

- **Dialled** and **Connected** from `buildAgentReport`, so they carry the same
  leads-not-follow-ups counting and the same exhaustive Connected split as every
  other report here.
- **Talktime** is the dialer's *total* minutes — `CALL_TALKTIME_MINUTES`, the
  figure the Talktime KPI reports — not the average per call the agent tables
  show. A mandate of "180 mins" is plainly a daily total, and a second
  definition of talktime is how two reports start disagreeing. Checked against
  production for 25 Aug: 206 / 192 / 189 minutes for the top three, which is the
  magnitude the KPI page showed that day.
- **Mandates are read from KPI Targets**, not stored again. Production currently
  has 300 / 80 / 120; the sheet says 300 / 120 / 180. **Change them on KPI
  Targets and this report follows** — that is deliberate, so there is one place
  to change an expectation.

**A partial window is measured against a partial mandate.** The week is Monday
to today and the month is the 1st to today, so a Wednesday is judged against
three days of mandate rather than seven. Overall has no day count, so its
percentage columns are a dash rather than an invented number.

**⚠ The Grand Total double-counts, by design of the sheet.** A + B + C adds
today, this week and this month, and those windows overlap — today sits inside
this week, which sits inside this month. It is the sum the sheet asks for, not a
count of distinct work, and the footer says so. Its percentage is measured
against the same three windows' mandates summed (1 + 6 + 29 days today), so at
least the fraction is internally consistent. **Worth confirming with Himanshu
whether he wants it at all.**

Verified against a seeded scenario and then against a raw dump of one agent's
follow-ups: Sohit Rajput's 9 distinct leads all-time, 8 in the month, 6 in the
week are exactly what the report printed, and his Connected figures follow the
latest-feedback rule correctly (a lead whose latest in-month feedback is RNR
lands Not Connected; one whose latest is a Warm "Call Back" lands Connected).
Grand Total 9 + 19 + 21 = 49 checks out.

#### The summary table, and a percentage bug it exposed

The email now opens with **OVERALL CALLING REPORT SUMMARY** — one row per window
(Daily / Weekly / Monthly / Overall) carrying the active headcount and the same
three figures, under the black TOTAL band. The detail table follows below it.
Same builder, so a summary row and its matching block total in the detail table
are the same numbers by construction, not two calculations that could drift.

**Building it exposed a real bug in the block totals shipped an hour earlier.**
A mandate is *per agent per day*, and the total rows were dividing the whole
floor's work by one agent's mandate. Eleven agents each hitting 300 would have
read as **1,100%**. Totals now divide by mandate x days x people; agent rows
still divide by one person.

**"Active" means agents who dialled at least one lead in that window**, not the
whole roster — so a day when half the team is on leave is not reported as a
collapse. That is also why the summary puts the count immediately before the
figures it explains: the row reads "2 people, 9 calls, 2% of a 600-call
expectation". Verified that the count moves with the window: two agents active
today, three across the week.

Checked cell by cell against a seed: Daily 9 dialled / (300 x 1 day x 2 active)
= 2%; connected 5 / (80 x 1 x 2) = 3%; talktime 45 / (120 x 1 x 2) = 19%; Weekly
15 / (300 x 6 x 3) = 0%. Every figure matched, and each summary row equalled its
block total in the detail table.

**Not a download.** This one is email-only; say the word if it should also be a
button somewhere.

---

**Everything else below is deployed.**

**Two operational tasks are still open**, neither of them a deploy:

1. **The missed-call backfill has not been run.**
   `node scripts/backfill-missed-call-agents.js --apply` on the box. The dry run
   found 638 abandoned calls with nobody attributed, of which 572 resolve to a
   real agent from the sticky tag in the stored payload; 66 stay unattributed.
   Without it only missed calls arriving *after* this release show an agent —
   the parser fix cannot reach back through rows already stored.
2. **The 402 production lead codes are still unmapped**, so newly ingested leads
   read `NA` for Data Calling Type. See "Map the lead codes" below.

### Noticed on the box during this deploy — NOT caused by this release

`P2024 Timed out fetching a new connection from the connection pool
(connection_limit: 3, timeout: 10)` on `/api/notifications`, with a
`JWT_SESSION_ERROR` behind it, written at 13:45 — while `next build` had the box
down to **77 MB free**. The old process could not get a connection under that
pressure. It stopped at the restart, and the error log has not grown in the
minutes since.

Worth a decision rather than a fix here: **a connection limit of 3 is low** for a
box that also carries a cron, a dialer webhook and SSE streams. Raising it costs
memory this box has little of, so it is a trade rather than an oversight — but a
deploy during working hours will keep producing these until either the limit goes
up or the build stops competing with the running app.

---

## 9. Shipped on 2026-08-27 (releases 2 and 3)

Release 2, deployed this morning (pm2 restart 07:51): `804ce41` Mask Data,
`4ee0850` missed calls, `1bc8f52` Priority Settings.

Release 3, deployed 13:47: `e90fe79` the missed-call ring, `66615dc` the
Connected split and the reports rework.

Both `ALTER TYPE … ADD VALUE` statements release 3 needed were run standalone,
in their own psql calls under autocommit, **before** the code, after a verified
`pg_dump` (`~/backups/crm-20260827-133331.sql.gz`, 5.0 MB, `gunzip -t` clean):
`NotificationType.MISSED_CALL` and `EmailReportType.AGENT_WISE`.

Verified after: deployed commit `66615dc`, pm2 `crm` online, the regenerated
client carries both enum values, `migrate diff` reports only the known `Lead.id`
line, the ownership check returns nothing, `totals.other` appears zero times in
the built server bundle, `/login` returns 200 publicly, `/api/notifications`
returns 401 rather than 500, and both new enum values are queryable.

### Priority Settings — auto-assign incoming leads by Data Calling Type

`lib/priority-assignment.ts` (new), the settings API and page (new), both
ingestion paths, `lib/pin-gated-actions.ts`, sidebar and topbar.

**Needs one new table.** Plain `CREATE TABLE`, transaction-safe. The full
statement is in `scratchpad/priority-ddl.sql` — it includes
`ALTER TABLE … OWNER TO crm`, without which the app (which connects as `crm`)
gets `permission denied`; that is what broke production on 2026-08-18.

Configurations → **Priority Settings**, Super Admin only and PIN-gated —
reading included, because the page shows exactly which agents are quietly
receiving leads. A lead arriving with one of the chosen Data Calling Types goes
to the next agent in the list, round-robin. Off by default.

**It runs after the Data Calling Type is resolved**, so it matches the value the
lead will actually carry — for a mapped lead code that is LeadCode List's value,
not whatever the payload asked for. An unmapped code resolves to `NA` and never
matches a rule.

**The rotation is a reserved range, not a read-then-write.** One atomic
increment claims the whole batch, so two uploads landing together take disjoint
slots instead of both starting at the same agent — and a 1,000-lead CSV costs
one cursor write rather than a thousand. Editing the agent list does not reset
the cursor: the rotation carries on rather than handing the next several leads
to whoever sorts first.

**Agents are re-checked live at assign time**, not trusted from the stored ids.
Deactivate someone and they drop out on their own. If every chosen agent goes
inactive the leads stay unassigned — the Assign Leads queue is where an
unroutable lead belongs, rather than forcing it somewhere.

`assignedById` is left null on an automatic assignment, which is what
distinguishes it from one a TL made by hand.

**CSV leads are created PENDING**, so an auto-assigned one is decided at upload
but only reaches its agent on approval. API leads arrive APPROVED and land
immediately. The page says so rather than leaving it to be discovered.

Turning it on with no types or no agents is refused with the reason — a setting
that looks enabled and does nothing is the worst kind.

Verified end to end through the real API: seven leads with a lead code mapped to
L1 distributed 3/2/2 across three agents, a second batch continued the rotation
instead of restarting, a lowercase `l1` matched, and `L2`/`NA`/null were left
alone. With the switch off, matching leads were untouched. All four bad-input
guards returned 400 with the reason.

### Missed calls

`lib/dialshree-webhook.ts`, `app/api/leads/missed-calls/route.ts` (new),
`components/calls/missed-calls-table.tsx` (new), the Scheduled Calls page,
sidebar and topbar labels. Code only, **no DDL** — CallLog already had every
field this needs.

**Why they were invisible.** The abandoned calls were being stored all along —
**601 of them on production, from 22 Aug, every one attributed to nobody.** What
was missing was the agent. `agentSeat` came from the dialer's `user` field, and
checking the real payloads shows why that fails:

| | `user` | `campaign` |
|---|---|---|
| outbound (AGENT / CALLER) | the real seat, `100098` | `INDO INTERNET PR…` |
| inbound `ABANDON` | **`VDCL`** — the trunk, not an agent | `sticky100096` |

So `user` is not empty on a missed call, it is *present and useless*. **Sticky
therefore leads and `user` is the fallback**, not the other way round — the
first cut had it backwards and would have attributed nothing, because `user`
always won. Sticky only ever appears where it is the right answer: an outbound
campaign is a real name and never matches `sticky<digits>`.

`security_phrase` is read first and `campaign` second. On production
`security_phrase` is usually empty and `campaign` carries the tag, so taking
whichever is present is what makes this work at all. `INDO_INTERNET_IN` and
other non-matching values are ignored rather than guessed at.

A call counts as missed on `term_reason: ABANDON`, matched case-insensitively
because the value is the dialer's, not ours.

**No new table and no new column.** "Missed" is a property of a call the dialer
already told us about, so it is derived from `termReason` on CallLog rather than
recorded again.

**The 601 existing rows do need a backfill**, though — the parser fix only
applies to webhooks that arrive after it. Until they are attributed, an agent's
Missed tab is scoped to their own id and shows nothing historical; only a
manager would see them. `scripts/backfill-missed-call-agents.js` recovers the
seat from the raw webhook body kept on each row, so DialShree does not have to
resend anything. Read-only unless given `--apply`. **535 of the 601 resolve to a
real agent** — Nisha 99, Shubham Kumar 82, Mann 79, Priyanka 67, Yash 59,
Zaid 47, Pradyumna 40, Harsh 35, Shivam 27, Shubham Rajput 1 — and the 66 with
no sticky tag stay unattributed, which is honest rather than guessed.

**Menu is now Scheduled/Missed Calls**, in the sidebar and the topbar, and the
page gains a Missed tab beside Pending/Overdue/Done/Cancelled/All. It swaps the
whole table, since these rows come from the dialer rather than from
ScheduledCall. Columns: lead (click to open the drawer), the number that called,
when, how long it rang, attempts, agent, latest feedback.

Two things are surfaced rather than hidden: a count of missed calls from numbers
matching no lead — somebody rang and got nothing back, and nobody owns the
follow-up — and, where a dialer seat maps to no CRM user, the raw seat in amber
so the gap is fixable instead of silent.

Scoped like Scheduled Calls (agent sees their own, TL their team, manager
everyone) and it honours **Mask Data**: the caller's number is contact detail
like any other.

Verified against a webhook posted exactly as DialShree describes: an ABANDON
with no `user` field resolved to the right agent from `sticky100098`, matched
the lead by phone, and appeared under Missed with a 22s ring and 2 attempts. A
normal answered call in the same shape stayed off the tab and kept its own
`user` seat.

**Also fixed while here:** `prisma/seed.ts` still granted `MASK_UNMASK_DATA` to
REPORTS under its old "may unmask" meaning, which would have brought a fresh
environment up masking exactly the wrong people. The applied migration
`20260604110000_seed_default_permissions` still carries the old values and is
deliberately left alone — editing an applied migration breaks its checksum — so
a brand-new environment should have that one row corrected after seeding.
Production is unaffected: it has no `MASK_UNMASK_DATA` rows at all and follows
the code defaults.

### A missed call rings and shows on screen

`prisma/schema.prisma`, `app/api/webhooks/dialshree/call/route.ts`,
`components/notifications/notification-bell.tsx`, the Scheduled/Missed Calls
page.

**⚠ Needs DDL, and it is the one kind that cannot go inside a transaction:**

```sql
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MISSED_CALL';
```

Run it **standalone and before the code**. Postgres refuses `ALTER TYPE … ADD
VALUE` in a transaction block, so it cannot be batched with anything else. If
the code goes first, every abandoned call hits `notification.create` with an
enum value the database does not know and the webhook logs an error — the call
itself is still stored, but nobody gets told about it.

**Built on the notification pipeline that was already there** rather than a
second one beside it. The bell already had the SSE stream, the unread badge, the
toast and the shake; a missed call is just a new `type` flowing through all of
it. So it works everywhere the bell already works, and it needed no new
endpoint, no polling loop and no socket.

**The ring is distinct from the chime.** Everything else chimes; a missed call
plays two 0.4s bursts of a 440/480 Hz pair 0.9s apart — the phone-ring interval,
recognisable without being looked at. When a batch arrives at once only one
sound plays, and the ring wins: somebody is waiting for a call back, which
outranks a lead being assigned.

**It only ever fires for genuinely new calls.** Two guards, because they catch
different things:

- *Server:* the dialer retries the same `uniqueid`, and the upsert cannot say
  whether it created or updated. An existence check runs **before** it, so a
  retry updates the call log and raises no second notification.
- *Client:* notifications already sitting unread when the page loads are seeded
  into `soundedIdsRef` on first fetch. Opening the CRM in the morning does not
  set off a ring for last night's calls.

Clicking through goes to Scheduled/Missed Calls **on the Missed tab** —
`?tab=missed` seeds the filter, so the agent lands on the call rather than on a
page where they still have to find it.

Verified in the browser, on the agent's own account: an ABANDON webhook posted
while they sat on the dashboard produced the toast ("ARMAN tried to reach you."),
a red `PhoneMissed` icon, the badge at 1, and — captured by recording the
oscillator frequencies the page actually played — the tones `440, 480, 440, 480`,
the ring rather than the chime. A repeat of the same `uniqueid` raised nothing.
The action link opened the Missed tab.

One cosmetic note, pre-existing and not from this change: on a browser that has
not dismissed it, the PWA "Install" prompt sits in the same corner and overlaps
the toast. It affects every toast the app shows, not just this one.


### KPI Targets — a custom date range on Agent achievement

`lib/kpi.ts`, `app/api/kpi/targets/route.ts`, the KPI Targets page. **Code only,
no DDL.**

A **Custom** button beside Daily / Weekly / Monthly / Quarterly opens two date
boxes and an Apply. The heading then reads the range ("20 Aug 2026 – 24 Aug
2026") instead of "Today", and Clear puts it back.

**What a custom range is measured against.** Targets are stored per named
period, so an arbitrary range has none of its own. It uses **the daily target ×
the days the range covers** — 300 dialed calls a day over 5 days is a target of
1,500 — and the column header shows its working (`300 × 5d`) so nobody has to
work out why the number is not the one they configured. Every calendar day
counts, **Sundays and week-offs included**, so a range spanning a day off asks
for more than the days actually worked. Himanshu chose this over excluding
Sundays.

**Points are not scaled.** Points are the weight of a KPI, not a quantity of
work, so the scoreboard stays out of the same 40 whatever window is shown and a
week can still be compared with a day.

**A live-count KPI keeps its daily target.** Hot Leads and Warm Leads are
`LEAD_STAGE_LIVE` — they count what is on an agent's desk *right now* and
deliberately ignore the window. Scaling those would ask for 2 × 14 = 28 hot
leads across a fortnight and could never be met, so snapshot sources are
excluded from the scaling and their header says `live count` rather than a
multiplication. This is the one part of the feature that is easy to get wrong.

**The scaling happens on the server**, not in the browser, so the table header,
the cells and the CSV export cannot disagree about a scaled number. The export
names the window it came from (`Custom · 5 days`) and the file is named after
the dates.

**Ranges are capped at 366 days.** Longer refuses with the day count, and the
Apply button disables with the same reason before a request is even made — the
page runs one query per agent per KPI, and a multi-year window makes each of
those a full-table scan.

Verified against seeded data on a known set of days, through the real API:

| range | expected | got |
|---|---|---|
| 20 Aug only — rows at 00:15 and 23:45 **IST** | 3 | 3 |
| 21 Aug only | 5 | 5 |
| 23 Aug — nothing logged | 0 | 0 |
| 20–22 Aug | 10 | 10 |
| 20–24 Aug, with an empty day inside | 14 | 14 |
| dates sent backwards (24 → 20) | 14, swapped | 14 |

The first row is the one that matters: those two follow-ups fall on a different
**UTC** day, so a range anchored to UTC would report 1 or 2, not 3. Targets
scaled 300 → 900 → 1,500 with the base held at 300; Hot/Warm stayed at 2; the
total stayed out of 40; a 2,428-day range disabled Apply with its reason; and
sending only `from` fell back to the named period rather than inventing a
window.

### Report emails restyled — plain amber-and-black tables

`lib/email-reports.ts` only. **Code only, no DDL.**

Himanshu asked for the styling in his own AI-costing mail: an amber header row,
a pale cream every other row, black text throughout, and **a thin black rule
around every single cell**. The card chrome is gone — no rounded corners, no
navy header bar, no grey page background. A plain bordered grid is also what
survives being forwarded and pasted into a deck, which is what happens to these.

The palette lives in five constants at the top of the file and every cell in
every report goes through one `cellBox` helper, so the theme is defined once and
cannot drift between reports as it had begun to (three different header greys
and two different creams were in there).

Applied to **all five** email types: Team performance, Agent performance,
Feedback summary, University / College wise, and the Welcome email. The welcome
mail is not strictly a report, but it shares the shell and would have been the
lone navy card left; its label column is now the amber header and its button is
black. Say the word if that one should go back.

**Two things deliberately dropped**, both worth knowing:

- The green Connected / red Not-connected figures are now plain black. The brief
  is a black-text table and colour-coding is not in it. It is two lines to put
  back if the traffic-lighting is missed.
- The team email used to be one long table with a divider row per agent. With a
  rule on every cell that no longer reads as a break, so each agent now gets
  their own bordered table under their own name.

Rendered all five against local data and checked them as images, not just as
markup: header amber, banding alternating correctly from the first data row,
every cell ruled, and the college table still scrolling sideways rather than
crushing its twenty-odd outcome columns.

**Every report starts flush left.** The shell wrapper was `margin:0 auto`, which
centred the 820px block inside Gmail's reading pane — so the narrow reports
(Feedback summary, Team, Agent) sat nearly 300px right of the wide College-wise
one, and right of the unsubscribe line the ESP appends underneath, making a mail
look indented next to its own footer. It is now `margin:0`; the 820px stays as a
cap. Measured in a 1400px pane: every report's greeting and table now begin at
18px, where the feedback summary previously began at 308px.

**Every field is centred**, headers and data alike. The one exception is the
welcome email's Name / Employee ID / Username list, which is a label-and-value
list rather than a report table and reads wrong centred.

**Each report opens with a greeting** above the heading:

> Hi Team,
>
> PFB the report.

Team performance, Feedback summary and College-wise all say "Hi Team,". The
agent performance mail goes to one person, so it says "Hi <their name>," — and
its heading changed from "Hello <name>" to "Performance report", which would
otherwise have greeted them twice. The welcome email takes no greeting; it is
one already. The subject lines are untouched, so nothing about the mail
threading changes.

Nothing about *what* the reports contain changed — same builders, same numbers,
same CSV attachments.

### University / College wise — every outcome column, biggest first

`app/dashboard/super-admin/reports/page.tsx`, `lib/email-reports.ts`,
`lib/ist-time.ts`. **Code only, no DDL.**

Himanshu sent the sheet this report replaces and asked for the last-feedback
count for every outcome, ordered high to low, in that layout.

**The counting was already right; the page was hiding it.** `buildCollegeBreakdown`
has always used `DISTINCT ON (leadId) … ORDER BY createdAt DESC`, so every column
is already "leads whose **last** feedback was this", and `availableOutcomes` has
always been sorted by count descending. The email used all of it. The **page**
did not: it defaulted to five hand-picked columns —
`['Walk-In', 'Application Done', 'Admission Done', 'Cold', 'Interested']` — in
that fixed order, so it silently omitted every other outcome and ordered the
five by nothing at all. That default is gone; the table now opens with every
outcome that occurred, biggest column first.

The picker still narrows the columns, but a narrowed set now keeps the by-count
order instead of the order the boxes happened to be ticked in.

**Row order matches the sheet:** the date banner sits *above* the header row, in
the page download and the emailed CSV alike. The emailed HTML already did. Our
banner row also carries the totals, where the sheet leaves it blank — strictly
more information in a cell that was empty.

**The date reads as a date.** `formatSheetDate` in `lib/ist-time.ts` turns
`2026-08-26` (and the email's `Today, 2026-08-26`) into `26/Aug/2026`. A range,
`Week of …` or `Overall` is returned untouched — there is no single date to
render and collapsing those to one would misstate the window.

Two things in the sheet deliberately **not** copied:

- It spells the second column **"Dailed"**. Ours stays `Dialed`.
- Ours is `Connected %`, the sheet has `Connected%`.

Both are one-word changes if he wants the sheet matched literally.

The **Other** column still appears only when some lead landed outside both
Connected and Not Connected. The sheet has no such column because that data had
none — this is not a difference in behaviour.

Verified against seeded data with deliberately uneven counts (Callback 22 down
to Walk-In 1): the columns came out `Callback=21 · Not Intrested=18 · RNR=15 ·
ICNA=11 · Wrong Number=9 · Switch Off=7 · Cold=5 · Interested=4 · Warm=3`,
strictly descending, every outcome present, in both the page table and the
emailed CSV. Callback landing on 21 rather than the 22 seeded is the
last-feedback rule working: one of those leads had a later follow-up saying
something else.

### ⚠ Connected / Not Connected was wrong — the "Other" column is gone

`lib/reports.ts`, `app/dashboard/super-admin/reports/page.tsx`,
`lib/email-reports.ts`. **Code only, no DDL. This changes reported numbers** —
read before deploying.

Himanshu spotted a row reading **Dialed 2, Connected 0, Not Connected 0, Other 2**
and said, correctly, that it is not a defensible thing to send management.

**The cause.** The split matched the *"Connected"* category by id and the
*"Not Connected"* category by id, and swept everything else into a third bucket.
But categories are not a reachability flag — an admin has also created **Hot,
Warm and Cold**. So an outcome like `Call Back` (category Warm) or
`Not Interested` (category Cold) matched neither and fell into Other, despite
obviously being a conversation that took place. Those two are exactly what the
Kros College row was.

**The rule now**, stated once in `buildAgentReport` and followed by
`buildCollegeBreakdown`:

> A lead is **Not Connected** when its latest feedback is in the "Not Connected"
> category, or carries no category at all. Everything else is **Connected**.

Exhaustive by construction, so Connected + Not Connected = Dialed on every row
and the Other column has no reason to exist. It is removed from the page table,
the page CSV, the email body and the email CSV.

**This moves numbers, and not in the direction the report implied.** The Kros
College row does not become "Not Connected 2" — it becomes **Connected 2**,
because both leads were spoken to. The old code was undercounting *Connected*,
not undercounting Not Connected. Expect connect rates to rise wherever
Hot/Warm/Cold outcomes are in use.

**The one case the split genuinely cannot decide** is an outcome with no
category — `categoryId` is nullable and `onDelete: SetNull`, so deleting a
category orphans its options. Those count as Not Connected, because a missing
category is not evidence that anyone was reached and that is the direction that
never flatters the figure. They are also **named** — an amber banner under the
table on the page, and a sentence in the email footer — so the gap gets fixed in
Manage Feedbacks instead of quietly skewing a number.

**The same bug was in `buildAgentReport`**, which feeds the Agent detail table,
the team totals, and the agent and team emails. Fixed in the same commit; those
columns had the same silent shortfall.

Verified with one outcome from each of the five categories, one per college:

| college | outcome (category) | dialed | conn | not conn |
|---|---|---|---|---|
| Kros College | Call Back (Warm) + Not Interested (Cold) | 2 | **2** | 0 |
| Goa Institute of Management | Interested (Connected) + RNR (Not Connected) | 2 | 1 | 1 |
| Sushant University | Hot (Connected) + Switch Off (Not Connected) | 2 | 1 | 1 |
| LPU | Admission Done (Connected) + ICNA (Not Connected) | 2 | 1 | 1 |

Every college row and every agent row added up, on the page and in the email.
Adding an option with no category moved its lead into Not Connected, kept the
row adding up, and raised the banner naming it.

### Agent wise report

`app/dashboard/super-admin/kpi/page.tsx`. **Code only, no DDL.**

Himanshu sent the sheet he keeps by hand and asked for it as a report. It is the
KPI scoreboard in wide form — its `Period` and `Range` columns are the KPI
Targets page's own period and range — so it is built there, from the payload
already on screen, rather than as a second computation that could drift from the
table above it.

**KPI Targets → the Export button is now "Agent wise report".** 33 columns, the
same count as the sheet:

- `Date, Agent, Employee Code, Period, Range`
- four per KPI — `Achieved, Target, %, Points Earned`
- `Total Score, Max Score, Score %, Grade`

Above them, the two banner rows from the sheet: a **Total** across every agent
in scope, then a band naming each block (`Dialed Calls Matrix`, …, `Scoring`).

**It follows the window shown.** Export on Weekly and every target in the file
is the weekly one; export on a custom range and the targets are the scaled ones,
with `Period` reading `Custom · N days`. The file cannot disagree with the table
it was taken from.

**Team targets are per-agent × headcount.** A daily target of 300 across five
agents is 1,500 in the Total row, not 300.

**A KPI with no target contributes blanks, not zeros.** "No target set" and
"achieved nothing" are different claims and a zero would make the second one on
the agent's behalf. Talktime is the live example — it is `NOT_MEASURED`, so its
Achieved, % and Points cells are empty while its Target still shows.

**Two things invented, because nothing in the data model defines them** — both
one edit away if he wants different:

- **Grade** is a plain 10-point band on Score %: A+ ≥ 90, A ≥ 80, B ≥ 70,
  C ≥ 60, D ≥ 50, E below. `gradeFor` at the top of the file.
- The **Total** row fills every cell the sheet left blank (%, points, score),
  because sums are unambiguous and a half-empty total row is less useful.

**The file opens as UTF-8.** A leading BOM was added: without it Excel reads
Latin-1 and the en-dash in every header becomes "â", which is exactly what
happened to the sheet this replaces.

Verified end to end by downloading the real file from the page and checking it
against seeded data — Himanshu 7 dialed / 4 connected, Phone Check 5 / 2, Sohit
Rajput 3 / 3. All 33 columns present on every row, the band row aligned to each
four-column block with `Scoring` at column 30, every percentage equal to
round(achieved ÷ target), every agent's Total Score equal to the sum of its
points columns, every Score % consistent with it, and the Total row equal to the
column sums with targets at one-agent × 5. Zero discrepancies.

#### It is also a scheduled email type

`prisma/schema.prisma`, `lib/kpi-grade.ts` (new), `lib/email-subjects.ts`,
`lib/email-reports.ts`, `lib/email-runner.ts`,
`app/api/super-admin/email-rules/route.ts`, the Email Automation page.

**⚠ Needs DDL, the kind that cannot go inside a transaction:**

```sql
ALTER TYPE "EmailReportType" ADD VALUE IF NOT EXISTS 'AGENT_WISE';
```

**Standalone, and before the code** — same rule as `MISSED_CALL` above. If the
code lands first, the Email Automation page offers a report type the database
will reject, and saving the rule fails.

Email Automation → **What to send** now lists *"Agent wise report — the KPI
scoreboard, every agent in one file"*. Built by `buildAgentWiseEmail` from the
same `computeKpiActual` and `kpiScore` the page reads, so the mail and the
download cannot disagree — verified by diffing the two CSVs, which came out
byte-identical.

**The rule's cadence is the KPI period it reports against.** `EmailFrequency`
and `KpiPeriod` carry the same four values, so a weekly rule is judged against
the weekly targets. A weekly email measured against a daily target would call
everybody a hero.

**It is a management report**, so it needs fixed addresses or roles. Added to
`MANAGEMENT_REPORTS` in **both** places that keep such a list — the page (which
flips the audience to Fixed on selection) and the API validator (which rejects
"each agent"). Missing the second would have accepted a rule that only failed at
send time.

**Agents in series, KPIs in parallel.** The page fires every query at once
because somebody is watching it load; this runs on the 9am cron beside every
other due rule, so it caps concurrency at one agent's worth.

`gradeFor` moved to its own `lib/kpi-grade.ts` — the page is a client component
and the builder is server-side, and a duplicated grading band would drift.

Verified without sending live mail: the enum round-trips through Prisma and
Postgres on a real EmailRule row, `migrate diff` reports no drift beyond the
known `Lead.id` one, the option appears in the dropdown, selecting it defaults
the audience to Fixed, the rendered mail spans a consistent 33 columns with the
band row carrying real colspans (5, then 4 per KPI, then 4), and the numbers
match the seeded data exactly. **No test email was sent** — mail is configured
locally and that is Himanshu's call to make.

### Mask Data actually masks

`lib/data-masking.ts` (new), `lib/permissions.ts`, four leads API routes, the
export, the Lead Approvals page, the WhatsApp button, the permissions label.
Code only, no DDL.

**The bug:** All Leads had no masking code at all. The list API sent real email
and phone to every browser and the page rendered them raw, so the toggle could
not mask anything there — nothing on that page read it.

**The direction was inverted, on request.** `MASK_UNMASK_DATA` meant "this role
may SEE unmasked data" (how the export and Lead Approvals used it). It now means
**"this role sees masked data"** — turning it on hides email and phone. The enum
name is unchanged: renaming costs an `ALTER TYPE` plus a data migration for no
behavioural gain. Manage Permissions now labels it *Mask Data (hide email &
phone)*.

**Masking moved to the server.** It used to happen in the browser on Lead
Approvals, which hid nothing — the real values were still in the JSON, one
devtools tab away. Now the API never sends them: All Leads list, the single-lead
route behind the drawer and profile, global search, the approvals list and the
CSV export.

**Super Admin is carved out explicitly.** `hasPermission` answers true for
SUPER_ADMIN on *every* feature, so reading this one through it would have masked
the one role that must see everything, with no toggle to undo it. `isMaskedRole`
returns false for them before it looks anything up.

**Call still works for a masked reader, WhatsApp does not.** The dialer already
works from the lead id server-side, so it never needs the number in the browser.
A wa.me link must contain the real number, so that button hides itself. It would
have hidden anyway — the asterisks strip to 8 digits and fail the length check —
but only by accident, so the intent is stated rather than left to it.

`lib/data-masking.ts` holds the pure string helpers and is free of Prisma,
because client components import it through `lib/csv-parser`; the rule for *who*
is masked lives in `lib/permissions.ts`, server-only. Getting that wrong would
have pulled Prisma into the browser bundle.

**⚠ Defaults change what a TL sees.** Production has no `MASK_UNMASK_DATA` rows,
so the fallback decides. It is set to preserve today's posture rather than
loosen it: REPORTS reads real values as they do now, and COUNSELLING_TL stays
masked because their CSV export is already masked today. The visible
consequence is that **a TL's All Leads will now show masked email and phone**.
If that is not wanted, switch Mask Data off for Counselling TL in Manage
Permissions. Agents are unmasked by default — turn it on for them if you want
them masked.

Verified: Super Admin unmasked everywhere; an agent with Mask Data on gets
`sh***@gmail.com` / `79****31` from the list API, the single-lead route, global
search, the All Leads table and the CSV export, with the Call button present and
WhatsApp gone.

Nothing shipped is waiting. **One operational task is:** see "Map the lead codes"
immediately below.

---

## 10. Shipped on 2026-08-27 (`fea4d9e`, `e136fef`, `c48bd58`)

Backup first: `~/backups/crm-20260827-024332.sql.gz` (4.4M, gzip-verified).

Deployed commit `c48bd58`. Verified after — pm2 `crm` online, the regenerated
client carries `leadCodeCallingType` and `LEAD_CODE`, the new page and the
import route are in the bundle, `migrate diff` shows only the known
LID-sequence line, ownership check zero, `/login` 200,
`/dashboard/super-admin/manage-lead-codes` 307 signed out, and `crm-error.log`
was last written nearly three hours *before* the restart.

**Existing leads were not touched by the deploy** — 18,582 still read `L1`, as
they did before. The mapping only rewrites leads when a code is actually mapped.

### ⚠ Map the lead codes — do this before the next upload or API push

Lead code is now the only source of Data Calling Type at ingestion, so **any
lead arriving before its code is mapped is stored as `NA`**. Nothing is broken
by that — mapping the code afterwards replaces the NA on those leads — but the
sooner the list is populated the fewer leads pass through NA.

Production has **402 distinct lead codes** and no mappings yet. A starter CSV of
all 402, each defaulted to `L1` (which is what every lead currently reads), is
at `scratchpad/prod_lead_codes.csv` — edit the second column, then upload it on
**Manage Dropdowns → LeadCode List → Upload CSV**.

### Recurring emails thread into one conversation, with an editable subject

`lib/email-reports.ts`, `lib/email-subjects.ts`, `lib/email-runner.ts`,
`app/api/super-admin/email-rules/route.ts`, the Email Automation page.

**Applied in the same transaction as the LeadCode column:**

```sql
ALTER TABLE "EmailRule" ADD COLUMN IF NOT EXISTS "subject" TEXT;
```

Plain `ADD COLUMN`, so it inherits the table's grants and is transaction-safe —
it can go in a `BEGIN/COMMIT` with anything else that day.

Each rule now has a **Subject line** field. Blank uses the report's own subject,
shown as the placeholder so it is obvious what will be sent. The defaults live in
`lib/email-subjects.ts`, a module with no server imports, because the rules UI is
a client component and reading them from `email-reports.ts` would have dragged
PrismaClient into the browser bundle. The builders read the same map, so the
placeholder cannot drift from what actually goes out.

Resolution happens once in the runner rather than in each branch, so no report
type can be left out of it. Whitespace-only counts as blank.

No date tokens in the field, deliberately: a subject that changes per send is
precisely what stops the mail threading.

Every recurring report had the date in its subject — "Team performance —
2026-08-25" — so each send was a new subject and each day started its own thread.
That is now the default rather than the only option.
Gmail and Outlook group by normalised subject plus participants, so a fixed
subject is what threads them: **Team performance**, **Your performance**,
**Feedback summary**, **University / College wise**.

Nothing that identified a send was lost. The date was already the subtitle under
the heading in all four, and it is on the EmailLog row as `periodLabel`
alongside `sentAt` — only the subject stopped changing. Verified for all four
that the date is still in the body.

Threading is per recipient, so Agent Performance still gives each agent their own
conversation, which is right — one thread each, not one shared thread.

**The robust form needs the provider.** Subject-based grouping is what
GoInfinito lets us do today; the RFC way is `In-Reply-To` / `References` headers
pointing at the previous `Message-ID`, and the Unified v2 payload we send has no
field for custom headers. Worth asking GoInfinito whether they expose one —
until then a fixed subject is the mechanism, and Gmail has been drifting toward
header-based threading, so this is worth confirming rather than assuming it
holds forever.

### LeadCode List — map a lead code to a Data Calling Type

**DDL applied 2026-08-27 02:43 UTC** — the two `ADD COLUMN`s wrapped in one
transaction, the enum value standalone outside it, all before the code.

```sql
-- autocommit, no BEGIN/COMMIT
ALTER TYPE "DropdownType" ADD VALUE IF NOT EXISTS 'LEAD_CODE';
ALTER TABLE "DropdownOption" ADD COLUMN IF NOT EXISTS "leadCodeCallingType" TEXT;
```

New Manage Dropdowns page, **LeadCode List**. An admin adds a lead code and
picks its Data Calling Type from a dropdown fed by the live DATA_CALLING_TYPE
list, so the two screens can never disagree about what is a legal value. Saving
with a value that is not an active Data Calling Type is refused by the API too,
not only the form.

**"Lead Code" is the `campaign` field** — that is what the All Leads column and
filter are labelled, and what the ingestion API already calls `leadCode`. No new
column on Lead.

**The mapping is written onto `Lead.dataCallingType`, not derived at read time.**
Deriving would have been less destructive, but the All Leads filter, the
filter-options list and the CSV export all read that column: a derived value
would have shown P1 while filtering for P1 found nothing. Verified after: the
column reads L2 and filtering by L2 returns those leads.

**It overrides whatever the lead had, and applies to existing leads on save.**
Not a soft default — on production all 16,337 leads already carry a Data Calling
Type and every one reads `L1`, so a mapping that only filled blanks would never
do anything. The save reports what it did ("5 leads now show L2"), because
silently rewriting thousands of rows is how a tool loses trust.

**Matching ignores capitalisation.** Production carries the same code in several
casings — `KCLL`, `Kcll` and `kcll` all appear, as do `BM101` and `bm101` — and
the All Leads campaign filter is already case-insensitive. A case-sensitive
mapping would have missed most of the leads an admin thought they had just set.

New leads pick it up too, on both CSV upload and the ingestion API. That lookup
comes off the **prebuilt** `buildDropdownValidationSets` maps rather than a query
per lead: the bulk API path creates inside a `Promise.all`, so a per-lead lookup
would have been one extra query for every lead in the batch.

Deactivating a mapping stops it applying to new leads but does **not** blank the
leads already written — that is not recoverable from here.

**Bulk import.** An *Upload CSV* button on the same page takes
`lead_code,data_calling_type` (header spellings and capitalisation are both
forgiving, and there is a template to download). Every row's Data Calling Type
must be one of the active options — anything else is listed back with its row
number and skipped, rather than written. A code already in the list is updated
rather than duplicated, matched case-insensitively so `ckt200` in a file does
not create a second row beside `CKT200`; the unique index is case-sensitive, so
a plain upsert would have made exactly that mess. A code repeated inside one
file takes its last row, and the count is reported.

One bad line no longer costs the whole file: rows are validated individually
rather than by a schema over the whole array, which was rejecting a good upload
of thousands because a single lead code was blank.

**An unmapped lead code now stores "NA".** A lead arriving by CSV or API with a
code that is not in LeadCode List gets `NA` rather than whatever the payload
carried, so it is visibly waiting to be mapped — and All Leads' Data Calling
Type filter can find exactly those. Mapping the code later replaces the NA,
which is the same `applyLeadCodeMapping` the single-add uses.

**⚠ Order matters on the day.** The lead code is now the *only* source of Data
Calling Type at ingestion, so from the moment this deploys every newly ingested
lead reads `NA` until its code is mapped. Upload the lead-code CSV **first**,
before the next CSV upload or API push. Existing leads are not touched — they
keep their current value until their code is mapped.

`dataCallingType` on the v1 API is now **optional and ignored** rather than
required and validated. Loosened rather than removed, so no live integration
breaks; the CSV column is likewise accepted and no longer rejected, since
failing a row over a field with no effect would be pointless.

Verified: five leads across three casings all updated; unmapped and blank codes
untouched; trimming works; the picker lists exactly the active Data Calling
Types; Save stays disabled until one is chosen; All Leads shows L2 for every
casing with the filter agreeing. On the import — a six-row file added 3, skipped
2 with reasons ("SOMETHING_WRONG" is not an active type; blank lead_code),
reported 1 in-file duplicate, updated 5 leads, and the duplicated code took its
last row (L1, not the earlier l3). A lead ingested with an unmapped code read
NA and switched to L3 the moment that code was mapped.

### Feedback summary — a share column

`app/dashboard/super-admin/reports/page.tsx`. Code only, no DDL.

The table was capped at `max-w-xl`, leaving most of the row empty. It now runs
full width with a **Share** column: a proportional bar plus the percentage, so
the distribution is readable at a glance instead of being arithmetic the reader
does in their head.

**One hue for every bar, not one per category.** The column's job is magnitude,
and a colour per row would be a 22-way rainbow encoding nothing — the category
is already carried by the row tint. Square at the baseline, 4px rounded at the
data end, 8px thick, track a lighter step of the same hue.

A row that exists never reads "0%" — anything under one per cent shows `<1%`,
because a listed outcome did happen. The raw count stays in its own column, so
the bar is never the only encoding and the table remains its own accessible
view.

Verified in both themes: the table fills its row (1194 of 1196px), exactly one
bar colour and one track colour across every row, and the widths sum to 100.0%.

---

## 11. Shipped on 2026-08-26 (`4cb3b63`, `41347c1`, `4aeb0d7`)

Backup first: `~/backups/crm-20260826-080629.sql.gz` (3.9M, gzip-verified).

Order was DDL → deploy, with no data step. Deployed commit `4aeb0d7`; verified
after — pm2 `crm` online, the regenerated Prisma client carries both new
`EmailReportType` values, the new builders are in the deployed bundle (including
the cron route that will run them), `migrate diff` shows only the known
LID-sequence line, ownership check zero, `/login` 200,
`/dashboard/super-admin/performance` 307 signed out, the email cron is still
installed, and `crm-error.log` was last written eight minutes *before* the
restart — nothing new failing.

### Email automation for the two new reports

**DDL applied 2026-08-26 08:06 UTC**, both values standalone and outside any
transaction, before the code.

```sql
-- autocommit, no BEGIN/COMMIT
ALTER TYPE "EmailReportType" ADD VALUE IF NOT EXISTS 'FEEDBACK_SUMMARY';
ALTER TYPE "EmailReportType" ADD VALUE IF NOT EXISTS 'COLLEGE_WISE';
```

No data step afterwards — nobody was switched onto the new types; they simply
became available in the **What to send** dropdown. Confirmed after: the two
existing rules (Agent Performance and Team Performance, both DAILY at 20:30
UTC / 02:00 IST) are untouched and still the only ones scheduled, so no
unexpected mail goes out.

Both emails call the very same `buildFeedbackBreakdown` / `buildCollegeBreakdown`
the Reports page renders from, so a figure in an inbox and the same figure on
screen cannot disagree. The rule's **frequency** picks the window, since an
email has no date pickers — daily sends today, weekly the Mon–Sun week, monthly
the calendar month, quarterly the quarter.

Scope follows the same rule as the page: a rule with no TL counts every
follow-up whoever logged it (`{}`), a TL-scoped rule narrows to that TL's
agents.

The three management reports now share one recipient-resolution and one send in
`email-runner`, differing only in what they build and what the attachment is
called — three copies of that block would have drifted the first time one was
fixed. The `EACH_AGENT` guard is now a list of management report types rather
than a negation, so a future report type has to make its own choice instead of
silently inheriting one.

**Column choice in the college email is made for the reader**, because an email
has no picker: the same five the page defaults to, minus any that stayed at zero
everywhere — a column of zeros costs real width in Outlook and says nothing. The
attached CSV carries every outcome regardless.

Verified: both builders produce tables matching the screen (Total 9 on both, and
the college table's Dialed totals to the same 9); no `<style>` blocks, no
flex/grid and no overflow past 820px, so Gmail and Outlook will not mangle them;
both types save through the real PIN-gated API and appear in the rules list; the
`EACH_AGENT` guard refuses all three management types; and all six runner paths
(each type × whole-floor and TL-scoped) build cleanly and stop at the recipient
check with **zero** emails delivered.

### Performance Analysis — nine cards that drill through

`app/api/analytics/summary/route.ts`, `app/dashboard/super-admin/performance/page.tsx`,
`app/dashboard/leads/page.tsx`. Code only, no DDL.

Cards are now **Total Leads · Assigned Leads · Applications · Admissions** on
top, **Connected · Untouched · Hot · Warm · Talktime** below. Every one follows
the page's date range and team filter, and every one is a link into All Leads
showing the rows behind the number.

Applications and Admissions are **approved receipts** — money confirmed, not a
counsellor's claim — matching the Reports page rather than the much larger
"Admission Done" feedback count (195 vs 3 on production). Scoped by the lead
falling in the window rather than by date paid, so they read like every other
card here; the Reports page scopes the same figure by `paidDate` because it
answers a different question.

**Deep-linking needed All Leads to accept filters on the URL**, which it never
did. Read once into the initial state, so the reader can change anything after
landing without the URL fighting back, and the matching keys are pushed into
`activeFilters` — otherwise the filter would apply with no visible control to
see or clear it.

**A pre-existing bug surfaced and is fixed.** `called` counted approved leads
carrying feedback *regardless of assignment*, so it could exceed Assigned — the
stage above it in the funnel — and `untouched = assigned − called` came out
short. `called` is now assigned-scoped and `untouched` is counted directly with
the same predicate the All Leads "Fresh" tab uses, so `called + untouched =
assigned` exactly. On local that moved Untouched from 58 to the correct 59.

**Total Leads is the one card whose linked page shows fewer rows**, because All
Leads lists approved *and assigned* leads only — 15,482 of 15,968 on production.
Rather than hide that, the card carries a sub-line naming the gap. Verified
click-through on the other seven: card number and page count agree exactly.

Talktime links to Reports instead, where talk time is broken down per agent —
it is minutes, not a lead list, so All Leads has nothing to show. It is also the
one figure the date range means something different for: calls *placed* in the
range, not leads *created* in it. Labelled on the card.

**Renamed to "Performance Analysis"** in both places it appeared: the page's own
heading and the topbar title in `components/shared/header.tsx`. The sidebar entry
for the page already read that. The sidebar *group* stays "Reports &
Performance" — it holds this page and Reports, so it is a different label, not a
missed one.

**The Lead Pipeline Funnel, the Lead Status Breakdown bar chart and the four
rate cards (Approval / Assignment / Call / Interest) are removed.** They
restated in a second voice what the nine cards already say. What remains is the
cards, then Lead Uploads Over Time beside Feedback Distribution, then the Pivot
Breakdown and Team Distribution.

Dead code went with them rather than being left behind: the `FunnelStage` type,
the `funnel` field on the API response, the `STATUS_BARS` helper, and the
`funnel`/`funnelBase` locals. `BarChart`/`Bar` stay imported — Team Distribution
still uses them. Three comments that justified a count "so the funnel adds up"
were rewritten, since a future reader would have gone looking for a funnel that
is no longer there.

Export still emits the nine cards in screen order followed by the pipeline
figures. Those no longer appear anywhere on the page, but they are the approval
and conversion counts someone downloading a summary still needs.

Verified: all nine match independently-computed SQL; changing the date range
moves every card and carries into every link; following Connected Leads under a
range gave card 4 / page 4 with the date inputs visibly seeded.

### University / College wise report

Same three files as the feedback summary below, same window, same scope, same
counting rule — one lead, once, under its latest follow-up — so the **Dialed
column totals to exactly the feedback summary's Total**. Two tables from one
definition rather than two definitions that drift.

Columns: University Name, Dialed, Connected, Connected %, Not Connected, then a
column per feedback outcome. Totals sit on the top row as they do in the sheet
this replaces. Downloads as CSV in the same column order.

**The outcome columns are chosen by the reader**, defaulting to the five the
sheet tracked (Walk-In, Application Done, Admission Done, Cold, Interested),
with a **Select all** row in the dropdown.

`MultiSelectFilter` gained a `selectAll` prop for that, and it is **opt-in**:
of the 37 dropdowns built from that component, exactly one passes it. Not a
default, because several of the others are backed by long lists — the All Leads
city filter carries 946 values on production, and selecting them all would put
about 20 KB of city names into the query string and break the request. The
change to the shared component is purely additive (no line removed) and the row
renders behind a single `selectAll &&` guard, so the other 36 are byte-identical;
spot-checked in the browser on All Leads (Cities, States, Courses, Colleges) and
on this page's own Team Leader and Agent filters, none of which show it.

While a search is typed the row acts on the matches only and says so —
"Select all matching (3)" — rather than quietly selecting entries off-screen. It
flips to "Clear all" once everything in view is on, and shows a dash rather than
a tick when only some are.
Matched by label and skipped when absent, so renaming or deleting a feedback
option costs a column rather than crashing; if none of the five exist it falls
back to the busiest outcomes, so it is never blank for a differently-configured
org. Every outcome's per-college count is already in the response, so changing
columns costs no query.

**An `Other` column appears only when it is non-zero.** Connected + Not
Connected only adds back to Dialed while those are the only two categories,
which is true of production *today* — but Manage Feedbacks lets an admin add
another at any time, and the first cut would then have shown rows that silently
failed to add up. Caught on local, which already has Hot/Warm/Cold categories
that production does not.

Connect rate is rendered plain, **not** through `pctTone`. That scale means
"share of target achieved", where under 50 is a miss; a 40% connect rate is an
ordinary day and colouring most of the report red would say something untrue.

Leads with no college appear under `(No college set)` rather than being dropped,
or this table's Dialed total would silently disagree with the summary's Total.

Verified locally across four colleges: every row satisfies Connected + Not
Connected + Other = Dialed, the rows sum to the totals row, the Dialed total
equals the feedback summary's Total, Connected % is Connected/Dialed, the column
selector adds and removes outcomes, and the CSV matches the grid exactly.

### Feedback summary on the Reports page

`lib/reports.ts`, `app/api/reports/agent-performance/route.ts`,
`app/dashboard/super-admin/reports/page.tsx`. Code only, no DDL.

Replaces a hand-kept spreadsheet: the university count on top, one row per
feedback outcome, a total at the foot, and a Download that emits the same two
columns in the same order so it pastes straight back into that sheet.

**Counts leads, not follow-ups**, placing each lead under its **latest**
follow-up in the window — the same latest-wins rule as the All Leads pills, the
Dialed/Connected columns and the Hot/Warm KPIs. That is what makes the table add
up: every lead appears exactly once, so the rows sum to the Total. Counting
follow-ups would list a lead under both Hot and Warm if the agent changed their
mind, and the Total would overshoot the number of leads worked.

Outcomes nobody used are simply absent — the grouping only returns what
happened, so there is no zero row to filter out.

**It follows the agent filter, unlike Team totals above it.** Team totals
deliberately ignores that filter; a second table that also ignored it would look
broken when someone picks an agent and nothing moves.

**Counts every follow-up, whoever logged it** — not just active counselling
agents. The first cut inherited the agent-performance scope
(`COUNSELLING_AGENT + isActive`) and that was wrong twice over: a follow-up
logged by a Super Admin or a TL vanished, and so did the whole history of any
agent since deactivated, which would quietly shrink an Overall report every time
somebody left. It also disagreed with the All Leads pills, which do not care who
logged the follow-up. Caught when the user's own test follow-ups — logged while
signed in as Super Admin — did not appear. On production this is 8 rows of
17,281 today (5 by a Super Admin, 3 by a deactivated agent) and 4 leads whose
current feedback the summary would have missed, so it was small but real and
would have grown with staff turnover.

Only the *unfiltered manager view* is widened; a TL still sees their team and an
agent still sees themselves, so nothing leaks.

Rows are tinted by the admin-maintained feedback **category**, not by a
hardcoded list of "good" outcomes, so the colouring follows Manage Feedbacks
rather than drifting from it. Dark mode gets a stronger wash — /10 over a
near-black surface is invisible.

**One number that will look wrong but is not.** The Total can sit just below the
Dialed Calls figure in the strip above it: a lead two agents both worked counts
once here but once for each of them there. Measured locally at 22 vs 27, from
four leads with more than one agent. It is called out in the footnote so it does
not become a bug report.

Verified against production data before building (25 Aug: 2,636 leads, 16
universities, 22 outcomes — the same shape as the sheet it replaces) and end to
end locally on a seeded spread: rows summed to the Total, the changed-mind lead
appeared once under Warm, no zero rows, the agent filter narrowed 19 → 13, and
the CSV came out in the expected two-column shape.

---

## 12. Shipped on 2026-08-25 (`c37cdbf`, `23542e2`)

Backup first: `~/backups/crm-20260825-134222.sql.gz` (3.6M, gzip-verified).

Order was DDL → deploy → data, and that order mattered here: the enum value had
to exist before the code, and the two KPI definitions had to be flipped only
after it. Deployed commit `23542e2`; verified after — pm2 `crm` online, the
regenerated Prisma client carries `FEEDBACK_LEADS_LATEST`, `migrate diff` shows
only the known LID-sequence line, ownership check zero, `/login` 200,
`/dashboard/super-admin/kpi` 307 signed out, and `crm-error.log` last written
13:56:08 against a 13:56:48 restart — i.e. nothing new since.

**Result on production:** Hot and Warm now agree with All Leads for every agent.

| Agent | Hot (KPI) | Hot (All Leads) |
|---|---|---|
| Harsh Yadav | 1 | 1 |
| Mann Vishnoi | 1 | 1 |
| Nisha chaudhary | 1 | 1 |
| Yash sharma | 1 | 1 |

Mann's Hot was 2 before this.

### Noticed on the box, NOT caused by this release — needs a look

`crm-error.log` carries six `P2028 Transaction already closed` failures from
`app/api/leads/[id]/feedback` — Prisma's interactive-transaction timeout is
5000 ms and the transaction ran 6535 ms and 14751 ms in the worst cases. Those
are **failed feedback submissions**: the agent would have seen an error and the
follow-up was not saved. All six predate today's restart, so this is standing,
not new. Worth either trimming the work inside that transaction or raising its
timeout — untouched for now because it is unrelated to what was being shipped.

### Hot / Warm Leads count a lead by its latest follow-up

**DDL applied 2026-08-25 13:42 UTC**, standalone and outside any transaction,
before the code. The two definitions were flipped only after the deploy landed —
doing it first would have pointed production at a source the running code had no
case for.

```sql
-- autocommit, no BEGIN/COMMIT
ALTER TYPE "KpiSource" ADD VALUE IF NOT EXISTS 'FEEDBACK_LEADS_LATEST';
```

Then, after the deploy:

```sql
UPDATE "KpiDefinition" SET source = 'FEEDBACK_LEADS_LATEST'
 WHERE name IN ('Hot Leads', 'Warm Leads');
```

Flipping the definitions first would point production at a source the running
code has no case for — `computeKpiActual` falls through to `default: return
null` and both columns would go blank.

**What was wrong.** KPI Targets showed Mann Vishnoi 2 Hot leads on 25 Aug while
All Leads showed 1. Neither number was miscounted; they answered different
questions. LID3251 was marked **Hot at 10:53 and downgraded to Warm at 11:43**
by Mann. The KPI counted the Hot event, the All Leads pill read the lead's
current feedback. This is not a corner case: of 22 Hot markings in August,
**14 leads are no longer Hot**.

Note this is a *different* fault from the Dialed Calls one. Switching to
`FEEDBACK_LEADS` would not have fixed it — Mann marked two **distinct** leads
Hot, so a distinct-lead count is still 2.

**The new source.** `FEEDBACK_LEADS_LATEST`, "Leads now at that feedback":
counts each lead once, by its latest follow-up **in the period**. A lead marked
Hot then Warm counts as Warm only, never both — the same latest-wins rule the
All Leads pills use (`Lead.currentFeedbackOptionId`) and the same rule the
Reports page now uses for its Connected / Not Connected split.

Period-scoped rather than a live snapshot, deliberately. `LEAD_STAGE_LIVE`
ignores the window, and a Hot count that ignored the window would compare a
whole standing pipeline against a target of 2 *per day* — every agent would max
that column out permanently.

**`FEEDBACK_LEADS` is kept and is not the same thing.** For a milestone like
Admission Done, a later "Callback" must not erase the admission, so
"given that feedback at any point" stays the right source. States use latest,
milestones use ever — both are now offered, with the help text saying which is
which.

**One trap found and closed while doing this.** `normalise()` in
`app/api/kpi/definitions/route.ts` decided which config to keep from a
hardcoded list of feedback sources. A Hot Leads KPI saved under the new source
would have had `feedbackOptionIds` silently emptied — the KPI would have stopped
meaning "Hot" and started counting every follow-up, jumping from 2 to ~300 with
no error anywhere. It now derives the answer from `KPI_SOURCES[].needs`, so a
future source cannot reintroduce this.

Verified end to end locally against a replica of Mann's day (lead A Hot then
Warm, lead B Hot): the agent's Hot column went 2 → 1, the "Hot" narrowing
survived a real PATCH through the API, Warm stayed 1, and with no narrowing at
all the new source returns exactly what `FEEDBACK_LEADS` does — so nothing else
that might adopt it changes meaning.

**Still on `FEEDBACK_COUNT` after this, awaiting a decision:** *Connected
Calls*. It would have differed from a lead-based count on 36 of 101 agent-days
in August. The Reports page already counts it latest-wins, so the KPI and the
report disagree until this one is flipped too.

### Application Form button on the lead

`components/shared/application-form-button.tsx`, wired into the lead drawer and
the full lead profile. Code only, no DDL — it reads the `landingPageUrl` column
that shipped with Landing Pages.

Sits beside WhatsApp on the Overview tab and opens the college's application
form in a new tab, already carrying the reading agent's ID. Same 36px pill as
its neighbours.

The URL is **not built in the browser**. It comes from `/api/landing-pages`
already resolved, so the agent ID in the link is decided server-side from the
session and cannot be spoofed or picked up from the wrong account.

The whole list is fetched once per session and cached under the same query key
as the Landing Pages page, so opening one warms the other. Asking per lead would
be a request every time an agent opens a drawer, hundreds of times a shift, for
a list of a few dozen colleges that barely changes.

Matched on the college **name**, because that is all a lead carries — no
`kappCollegeId` reaches the client. Safe because the importer resolves the KAPP
College ID to the dropdown's own value before storing it, so the two are the
same string rather than two spellings of one college.

Disabled, never hidden, with the reason in a tooltip — an absent button reads as
a bug worth reporting, a disabled one with a reason is an answer. Four states,
all verified in the browser on both surfaces:

| State | Shows |
|---|---|
| College has a link | violet `<a target="_blank" rel="noopener noreferrer">` |
| College has no link | disabled — "No application link is set up for X" |
| College not in the dropdown at all | same, named after whatever the lead carries |
| Lead has no college | disabled — "This lead has no college set" |

A fifth: an employee code with no digits in it cannot be tagged, so the button
is disabled rather than opening a URL with a raw `{{%agent%}}` in it — the same
rule the Landing Pages page applies to its Copy button.

---

## 13. Shipped on 2026-08-24 (`95a17cc`, `7e454d8`, `dc3824f`, plus `03580f2` from the day before)

Deployed commit on the box is `dc3824f`; the workflow took 7m10s. Verified
after: pm2 `crm` online, the regenerated Prisma client carries
`landingPageUrl`, `migrate diff` reports only the known LID-sequence line,
ownership check empty, `/login` 200, `/dashboard/landing-pages` 307 and
`/api/landing-pages` 401 when signed out, and `crm-error.log` untouched since
before the restart.

Bulk Delete was committed on 23 Aug but only reached production in this
release — the deploy is a manual dispatch, so a pushed commit is not a
deployed one.

### Reports page — Dialed / Connected / Not Connected count leads

`lib/reports.ts`. Code only, no DDL.

An agent who rings a student, gets no answer, logs it, and reaches them a minute
later has worked one lead, not two. These three columns counted follow-up rows,
so a normal day was inflated by a few per cent and the worst observed agent-day
by 13% (Zaid Sultan, 305 rows over 265 leads on 24 Aug).

The category split now uses each agent's **last follow-up on that lead inside
the window**, which is the same rule the All Leads pills follow — they read
`Lead.currentFeedbackOptionId`, the latest feedback. Two consequences, both
wanted:

- the columns still add up (Connected + Not Connected = Dialed), because a lead
  lands in exactly one category rather than both;
- Reports now agrees with All Leads. Verified on production data for 24 Aug:
  313 / 109 / 204 for Nisha, against pills of 109 + 204 = 313.

Counting "any Connected follow-up" instead would have double-counted the leads
that were missed and then reached, and the two category columns would have
overshot the total.

Raw SQL, because Prisma cannot count DISTINCT on a column. Grouping by
(agentId, leadId) and counting in JS would pull one row per agent-lead pair —
12,892 on production today, and growing forever. The query runs in 26 ms
unbounded. Date bounds go through `toUtcSqlTimestamp`, so the window is not
shifted 5h30m by the server's UTC clock.

`buildAgentReport` is the single source for the page, the CSV export and the
team-performance email, so all three move together.

**Changed directly on production, no deploy involved:** the *Dialed Calls* KPI
definition now uses `FEEDBACK_LEADS` instead of `FEEDBACK_COUNT`
(`UPDATE "KpiDefinition" SET source='FEEDBACK_LEADS' WHERE name='Dialed Calls'`).
KPI scores are computed live from the feedback table with nothing snapshotted,
so that restated every past period too. The two now agree: 313 on both, where
KPI Targets read 313 and Reports read 319 before this release.

Still counting follow-up rows, deliberately left alone:

- *Connected Calls*, *Hot Leads* and *Warm Leads* KPI definitions. Connected
  would have differed from a lead-based count on 36 of 101 agent-days in August,
  by up to 4. One-field change each, awaiting a decision.
- The Dashboard leaderboard (`app/api/dashboard-stats`, `callCount`). Same
  concept; would reorder the ranking slightly.
- "Total Feedbacks" on Performance Analysis (`app/api/analytics/summary`) — a
  count of follow-ups is what that label means, so it is correct as it stands.

### Landing Pages

**DDL applied 2026-08-24 14:36 UTC**, before the code went up. One nullable
column:

```sql
ALTER TABLE "DropdownOption" ADD COLUMN IF NOT EXISTS "landingPageUrl" TEXT;
```

`ADD COLUMN` inherits the table's existing grants, so the `crm` role needs no
further GRANT — this is not the create-a-table-as-postgres case. Verified after:
column present and nullable, `crm` still has SELECT/INSERT/UPDATE, and no table
in `public` owned by anyone but `crm`.

Backup taken first: `~/backups/crm-20260824-143603.sql.gz` (3.0M, gzip-verified).

**What it is.** Colleges give us one application URL for the whole floor. The
college needs to know which counsellor sent each applicant, so the URL carries
the agent in its `utm_medium`. A Super Admin stores the URL once against the
college, with `{{%agent%}}` where the ID goes, and the token is filled in per
reader at display time. Nothing per-agent is stored — a new joiner's links work
the moment their account exists.

- **Manage Dropdowns → Colleges** gains a *Landing Page Link* field: validated
  as you type, with a live preview and a clickable `{{%agent%}}` chip that
  inserts at the cursor (replacing any selection).
- **New sidebar entry, Landing Pages**, for every role. Card per college with
  logo, KAPP ID, zone, deal type, the finished URL, Copy and Open.
  Client-side search over college / ID / zone / deal type / URL.

**The agent ID is the digits of the employee code**, so `EMP-019` becomes `019`.
That is deliberately the same rule as the `digits()` helper in Lead
Integrations, which already populates `counsellor_id` when we push a lead — an
agent must not mean two different things to two of our own systems. Leading
zeros are kept: `019` and `19` are different agents to the college.

Validation runs through one function used by both the browser and the API, so
they cannot drift. It checks the *resolved* URL, not the template, because
`{{%agent%}}` contains `%a` — an invalid percent-escape that strict parsers
reject. `javascript:` and scheme-less links are refused server-side even if the
form is bypassed.

Two states worth knowing:

- A link with **no token** is valid — some colleges track by campaign only. The
  admin dialog says so rather than treating it as an error, and the list carries
  a quiet footnote.
- An employee code with **no digits in it** cannot be tagged. Those cards hide
  Copy and show "ask your manager" instead of handing over a URL with a raw
  `{{%agent%}}` in it. Campaign-only links on the same page stay copyable.

**Logos come from the LMS on a second request**, deliberately: the links are
ours and must appear instantly, while the LMS is a third party. The LMS has no
lookup-by-id, so each college is found by name search and matched on
`college_id` — matching on the id is what makes it safe, since a name search for
"Sushant University" returns four colleges. Cached an hour; a miss falls back to
the college's initials.

Verified end to end: the exact URL from the request resolves to
`…utm_medium=kcll_1008&utm_campaign=2027` and lands on the clipboard byte for
byte; save round-trips through the real API; deactivating a college removes its
link; light and dark both check out; no horizontal overflow at 430px.

### Assign Leads — the Assigned To cell

`app/dashboard/counselling-tl/page.tsx`. Code only, no DDL.

It was a pill badge with no width limit, so "Yash sharma" wrapped onto two lines
and pushed that row taller than its neighbours — the table looked ragged rather
than the name looking wrong. Replaced with a small initials avatar and the name
on one line, truncated with the full name on hover.

`Unassigned` mirrors the same shape — a dashed ring where the avatar sits — so a
row's height never depends on whether it has an assignee. Verified with a short
name, a two-word name and a 30-character one: all four rows measured 53px.

Initials take the first and last word, so "Shubham Kumar Rajput Chaudhary" reads
SC rather than SK, and a single-word name gives one letter.

The stored name is displayed exactly as entered — no title-casing. "Yash sharma"
is lower-case in the data, and auto-capitalising would corrupt names where the
casing is deliberate.

### Bulk Delete Leads — pick rows, delete one, and filter by assignment

Code only, no DDL.

| File | What changed |
|---|---|
| `lib/lead-query-filters.ts` | `assignmentStatus: 'all'` now normalises to undefined — see the safety note below |
| `app/api/leads/bulk-delete/route.ts` | Accepts an explicit `ids` list as an alternative to filters |
| `…/bulk-delete/preview/route.ts` | Returns the assignee |
| `app/dashboard/super-admin/bulk-delete-leads/page.tsx` | Assignment filter, row checkboxes, select-all, per-row delete, selection bar, Assigned To column |

**Two deletes, never side by side looking alike.** With nothing ticked the bar
reads *"Delete all N"*; the moment a row is ticked it switches to *"Delete N
selected"* and the delete-all button disappears. "Delete 2" and "delete 2,000"
should not be one slip apart on the same row of pixels.

**A safety hole closed on the way in.** `hasAnyFilter` treats any present value
as "a filter is set", and `assignmentStatus: 'all'` imposes no constraint — so
`assignmentStatus=all` would have satisfied the tool's refusal to run unscoped
while matching *every lead*. The field existed already; exposing it in the UI is
what made it reachable. `'all'` is now normalised away in the schema, fixing it
for every caller. Verified: a preview with only `assignmentStatus=all` is
rejected with `NO_FILTERS`.

**Chosen ids are not trusted.** They pass through the caller's own
`getLeadWhereClause` rather than going straight into a `deleteMany`, so an id in
a request body can never reach a lead the requester could not otherwise see.

**The previewed-count guard applies to the filter path only.** A hand-picked list
is exact by construction, and if one of the chosen rows was removed by someone
else meanwhile, deleting the rest is still the right outcome.

Per-row delete opens the same typed-`DELETE` confirm dialog as everything else —
a one-click irreversible delete is the easiest mistake on this page to make. The
dialog now names which delete it is confirming ("3 leads that you selected"
versus "3 leads matching these filters").

A selection delete keeps the filters and re-runs the preview so a clean-up can
continue; a delete-all still clears everything, since the result set is gone.
Selections drop whenever a new preview lands, so a selection can never outlive
the rows it was made against.

Audit rows record the mode and, for a selection, the exact ids — with no trash to
restore from, that is the only trace left of what went.

Verified end to end: the assignment filter splits 6 leads into 3 assigned and 3
unassigned; deleting 2 selected left 4; a single-row delete left 3; a made-up id
returns 404 rather than silently succeeding; an empty `ids` array is rejected;
and an ids delete without the PIN returns 423.

The uncommitted `.claude/settings.json` (local tool permissions) is deliberately
never committed, and this file is kept untracked so the repo and production can
never disagree by a docs-only commit.

---

## 14. Shipped on 2026-08-22, second release (`27c3186`, `2fd3eda`, `2a6f3a3`)


### Email Automation is PIN-gated

Code only, no DDL — `AdminActionUnlock.action` is a plain string, so the new key
needs no migration.

`EMAIL_AUTOMATION` added to `lib/pin-gated-actions.ts`, the page wrapped in
`<PinGate>`, and `requireSuperAdmin` in the rules API now also requires an
unlocked PIN. Same treatment as API Keys and Lead Integrations, which is right:
a rule can point company performance data at any address.

**Enforced server-side, not only in the UI** — a gate whose endpoints answer a
plain fetch is decoration. Verified all four verbs return **423 PIN_LOCKED** for
a signed-in Super Admin who has not entered their PIN, a wrong PIN is refused
with attempts remaining, the right one unlocks, and the unlock is **scoped to
this action**: Lead Integrations stayed locked afterwards.

**Deliberately not gated:** `/api/cron/email-reports` and the welcome email sent
on user creation. Those are machine-to-machine and automatic — the cron has its
own shared secret, and there is no human present to type a PIN. Gating them would
simply stop the scheduler working.

### Stop logging call and feedback events to the activity log

`lib/permissions.ts` — `logActivity` now drops `CALL_INITIATED`, `CALL_HANGUP`
and `FEEDBACK_SUBMITTED` before writing. The activity-logs page filter no longer
offers `FEEDBACK_SUBMITTED`, since nothing can produce it.

**These two were 65% of the table**: `CALL_INITIATED` 3,852 (33.5%) and
`CALL_HANGUP` 3,645 (31.7%) of 11,501 rows. They duplicated `CallLog`, which the
dialer's post-call webhook fills in with far more detail — talk time, recording,
disposition, connected verdict. `FEEDBACK_SUBMITTED` has never been written at
all; feedback is already a first-class `LeadFeedback` row.

**Filtered centrally, not by deleting the call sites.** One skip-set in
`logActivity` means a future caller cannot quietly reintroduce the volume, and
the two existing call sites keep their code intact.

**The enum values stay.** 7,497 historical rows still reference them and must
keep rendering; removing a Postgres enum value would need those rows migrated
first.

Verified by calling `logActivity` with all five action types: `LEAD_ASSIGNED` and
`USER_UPDATED` were written, the three skipped ones were not, and the row count
moved by exactly 2.

**Not done — needs sign-off:** the 7,497 existing rows are still there. Deleting
them would shrink the table by two thirds immediately, but it is irreversible.

### Log retention — delete ActivityLog and EmailLog past 3 months

Code only. No DDL, no new env var (reuses `CRON_SECRET`), one new cron line.

| File | What it does |
|---|---|
| `lib/log-retention.ts` | **New.** Cutoff maths and batched deletion |
| `app/api/cron/retention/route.ts` | **New.** GET = dry run, POST = delete. Secret-authenticated |

**Reality check taken before building.** On production today `ActivityLog` is
11,501 rows / 4.4 MB with **nothing older than 18 days**, and `EmailLog` is
empty. The biggest table in the whole database is `Lead` at 10 MB. So this purge
frees nothing yet — it is a guard against future growth, not a fix for a current
problem.

**Where the growth actually comes from:** `CALL_INITIATED` (3,852) and
`CALL_HANGUP` (3,645) are **65% of all activity rows**, and they duplicate what
`CallLog` already stores properly, with more detail. Not logging them would cut
the table by two thirds permanently — a bigger win than the purge, and worth
deciding on separately.

**Deletion is batched at 5,000 rows.** One `DELETE` over a huge table takes a
long lock and builds a single enormous transaction; on a 1 GB box that turns a
tidy-up into an outage. Batches commit as they go and the work is resumable.
`DELETE ... WHERE id IN (SELECT ... LIMIT n)` is what gives plain SQL a limit.
Both tables already carry an index on the timestamp column, so each batch is an
index scan.

**The cutoff is whole calendar months on IST dates**, with the day-of-month
clamped: 31 May minus 3 months lands on 28 February, not 3 March. Verified
across month-end and year boundaries. `LOG_RETENTION_MONTHS` overrides the
default of 3.

The cutoff is passed to SQL as an explicit UTC literal via `toUtcSqlTimestamp`,
never a JS `Date` — the driver would serialise it in the process timezone and the
cast to `timestamp without time zone` would drop the offset, shifting the cutoff
by 5h30m and deleting rows that should have been kept.

**GET is a dry run**, so what would go can always be checked first. Deletion is
irreversible and nothing is archived.

Verified with rows seeded at 400/200/120/95/91/90/89/45/1/0 days old: the dry run
reported 4 eligible and deleted none; the apply deleted exactly those 4 and left
91 days and newer untouched.

**Cron line needed at deploy** (nothing runs without it). Nightly, off-peak:

```
30 21 * * * /home/ubuntu/run-log-retention.sh     # 03:00 IST
```

Same pattern as the email scheduler: a 700 script that reads `CRON_SECRET` from
the app env and sends it as a header, so the secret never reaches syslog.

**Not changed, worth a decision:** the purge is blanket. `USER_CREATED`,
`PERMISSION_CHANGED` and `SECURITY_ACTION_UNLOCKED` are the audit trail and will
also be deleted at 3 months. Keeping those longer is a small change if wanted.

### Welcome email for new users — **needs `ALTER TYPE`, which is not transaction-safe**

A new joiner is emailed their login details the moment their account is created,
and the template is also selectable on Email Automation for re-sending.

| File | What it does |
|---|---|
| `prisma/schema.prisma` | `WELCOME` added to `EmailReportType` |
| `lib/email-reports.ts` | `buildWelcomeEmail` — name, Employee ID, username, password, both links |
| `lib/welcome-email.ts` | **New.** Sends it and logs the attempt |
| `app/api/users/route.ts` | Fires it after the account is created |
| `lib/email-runner.ts`, `…/email-rules/route.ts`, the config page | WELCOME as a rule type |

**The password only appears in the email sent at creation.** Passwords are stored
bcrypt-hashed, so there is nothing to retrieve afterwards — a *re-sent* welcome
therefore shows "Get your username and password from your Manager" in that row
rather than pretending the field is missing. Both variants carry the DialShree
agent link, and both tell the person to get their dialer credentials from their
manager, since the CRM never holds those.

**Worth raising: the CRM emails the plaintext password at creation.** That is
what was asked, and the admin already sees the same value on screen, so this adds
no exposure the admin did not already have — but it does put a working password
in an inbox indefinitely. Swapping it for a single-use set-your-password link
would be the stronger design if it is ever wanted.

**Sending never blocks account creation.** The call is outside the transaction
and deliberately not awaited: a mail provider having a bad minute must not roll
back a created user or hang the admin's screen. Failures land in `EmailLog`,
visible on Email Automation and re-sendable from there.

If an active WELCOME rule exists, its **Cc and Bcc are honoured** by the
automatic send too — which is how a manager gets copied on every new account
without any of it being hardcoded.

The email footer is now a parameter: the report boilerplate about KPI targets was
appearing under a brand new joiner's login details, where it meant nothing.

### DDL — run the enum value on its own

```sql
-- NOT inside a transaction (procedure rule 3):
ALTER TYPE "EmailReportType" ADD VALUE IF NOT EXISTS 'WELCOME';
```

Nothing else. No new tables or columns.

Verified: creating a user wrote a `SENT` row to `EmailLog` with a provider guid
and no rule configured; the at-creation variant contains the password, the
re-send variant does not and says to ask the manager; both contain the DialShree
link; and the KPI-targets footer no longer appears on either.

### Agent performance — joining date in, working days out

Code only, no DDL: `joiningDate` already exists on `User`.

`lib/reports.ts` swaps `workingDays` for `joiningDate` (ISO). The Reports page
table and its CSV export follow, and the email's agent header line gains
`Joined <date>`.

**TL name was already on both surfaces** — the page as an "Agent TL" column, the
email in the header line under each agent's name — so nothing was added there and
nothing duplicated.

Removing working days also removes the `Attendance` query that existed only to
compute it, so each report window is now one query lighter.

Verified with two seeded agents on very different joining dates: the page renders
`15 Mar 2024` and `18 Aug 2026`, the API no longer returns a `workingDays` key at
all, and the CSV carries the ISO date so Excel sorts it properly.

**Only the Reports page had working days** — the email had already dropped it in
the previous change, which is what pinned down which surface this request meant.

### Team performance email — four periods in one table, working days out, score in

Code only, no DDL. `lib/email-reports.ts` rewritten, `lib/kpi.ts` gains
`kpiScoreboardFor`, `lib/email-runner.ts` follows the new shape.

The email was a single flat list of today's numbers. It is now **one table with a
section per agent**: their details, then four rows — **Today, Yesterday, This
week, This month (1st → today)**. Working days is gone; **Score** is in, straight
from KPI Targets.

**Yesterday is scored against the daily target, anchored to yesterday.**
`computeKpiActual` derives its window from the `now` it is handed, so passing
yesterday's instant scores that day properly — no second set of targets needed,
and the two days are directly comparable.

**The month runs 1st → today, not 1st → month-end.** A report sent on the 8th
should not imply the month is over.

Periods sit as **rows, not columns**. Seven metrics across four periods would be
28 columns; no email client renders that legibly. Rows keep it to eight columns
and one screen.

Each period's score is out of that period's own maximum, so the denominators
differ by design — `45 / 50` daily against `42 / 200` monthly. A dash means no
target with points is set for that period.

**Caveat worth knowing:** a `LEAD_STAGE_LIVE` KPI (Hot Leads, Warm Leads) is a
snapshot of where leads sit *right now*, so it reads the same for Today and
Yesterday. It measures a standing position rather than a day's work. Noted in the
code where the scoreboard is built.

The CSV attachment is now **long format** — one row per agent per period — which
pivots cleanly in Excel instead of forcing a wide sheet.

Verified by rendering the real HTML against seeded data spanning four windows:
two agents, distinct figures per period, scores `45/50`, `50/50`, `60.5/100`,
`42/200`, and a live send delivered.

**Not changed:** the Reports *page* still shows Working Days. Only the email was
asked about; say the word if the page should match.

The uncommitted `.claude/settings.json` (local tool permissions) is deliberately
never committed, and this file is kept untracked so the repo and production can
never disagree by a docs-only commit.

---

## 15. Shipped on 2026-08-22, first release (`e678987`, `d3ff991`)

### CSV importer now de-duplicates within the file

**The bug:** `app/api/upload/route.ts` built its duplicate set purely from a
`findMany` against the `Lead` table, so it only ever compared incoming rows to
leads *already stored*. Every copy of a row inside one file is genuinely absent
from the table at the moment of the check, so all of them passed and `createMany`
inserted the lot.

**What it cost.** One upload on 22 Aug 2026
(`Sample leads __ Upload __ - leads_sample (3) (69).csv`, batch
`cmt4civab0d2uoueld22ej81g`) put **370 rows in for 88 real people — 282 surplus**.
Because leads are round-robin assigned, the copies went to *different* agents:
`7017133582` and `9335624618` each landed 18 times across 5 agents. **147
feedbacks and 129 calls** are already logged against that batch, so agents have
been separately phoning the same people. Five earlier uploads have smaller
surpluses (2–10 rows), so the gap was always there; this file was just far worse.

**How the cause was pinned down**, since three explanations were plausible:

- *Not repeated uploads* — all 19 rows for the three reported numbers share
  `createdAt` to the millisecond, one batch id, one `createMany`.
- *Not the code multiplying rows* — the batch accounting balances exactly:
  370 inserted + 881 already-in-CRM + 979 errors = 2,230 CSV rows.
- *The file itself* — repeat counts vary per lead (18, 12, 11, 9, 7, 3, and 14
  numbers appearing once). A loop bug multiplies every row by the same factor;
  uneven counts mean the source data arrived that way.

**The fix** keeps the same key as the database check (email + college) so a row
behaves identically whether its twin is in the file or already stored, and the
first occurrence wins — predictable, and the row the file's author would expect
to survive. Collapsed rows are counted in `duplicateRecords`, so the batch
arithmetic stays true.

The upload summary now separates **"already in the CRM"** from **"listed more
than once in your file"** — different problems with different fixes, and the
second one points at whoever produced the file.

Verified against a reconstruction of the real failure: 15 rows in (one lead ×9,
another ×3, one unique, one already stored ×2) produced **3 inserted, 2 already
in CRM, 10 repeated in file**, exactly one database row per person, and
`3 + 12 + 0 = 15`. The same file before the fix would have inserted 13.

**Not fixed here, deliberately:** the key is still email + college, not phone, so
the same person under two email addresses is still two leads. Changing that is a
policy decision — dedup on phone would also collapse siblings sharing a number.

**Still outstanding:** the 282 surplus rows already in production. Cleaning them
up means deciding which copy survives where several have feedback or calls
against them, and needs a backup and explicit sign-off first.

### Email automation

Scheduled performance emails through GoInfinito. Nothing about who receives what
is in code: an admin builds rules on **Configurations → Email Automation**.

| File | What it does |
|---|---|
| `lib/email.ts` | The GoInfinito client |
| `lib/email-schedule.ts` | Is a rule due, which period is it, what window does it cover — all on the IST wall clock |
| `lib/email-reports.ts` | The HTML, built from the same `buildAgentReport` the Reports page uses |
| `lib/email-runner.ts` | Turns a rule into sent mail and logs every attempt |
| `app/api/cron/email-reports/route.ts` | Secret-authenticated entry point for system cron |
| `app/api/super-admin/email-rules/route.ts` | CRUD + "Send now", Super Admin only |
| `app/dashboard/super-admin/configurations/email-automation/page.tsx` | The rules UI and send log |
| `prisma/schema.prisma` | `EmailRule`, `EmailLog`, 3 enums |

**The provider returns HTTP 200 on failure.** A rejected payload comes back as
`200` with `{"status":"Error","statuscode":65537}`, so `status` in the body is
the only honest signal — `res.ok` would log every failure as delivered. Same
trap as the LMS delivery-status endpoint, handled from the start this time.

**Scheduling is idempotent.** Each rule stores the period it last completed, so
cron can run every five minutes, and a run missed while the box was down is
picked up on the next tick rather than skipped for the day. Verified: two cron
runs in a row sent once. "Send now" deliberately does **not** consume the period
slot, so testing a rule cannot cancel that day's real delivery.

**Times are IST wall clock, stored as hour+minute.** The server runs UTC;
storing an instant would drift. Verified under `TZ=UTC`, including the rollover:
`2026-08-22T18:35Z` reads as `2026-08-23 00:05 IST, Sunday`. Monthly days are
capped at 28 so February is never skipped, and a quarterly rule only fires in
the first month of a quarter.

**Agent emails are sent in series with a 400 ms gap.** The box has under 400 MB
free; a parallel burst to twenty agents at 9am is how the whole app falls over.

Verified end to end on localhost: a rule saved, "Send now" delivered a real email
(provider guid recorded), the cron endpoint 401s without the secret and ran the
due rule with it, and the send log shows both.

### DDL

```sql
BEGIN;
CREATE TYPE "EmailReportType" AS ENUM ('AGENT_PERFORMANCE', 'TEAM_SUMMARY');
CREATE TYPE "EmailFrequency" AS ENUM ('DAILY','WEEKLY','MONTHLY','QUARTERLY');
CREATE TYPE "EmailAudience" AS ENUM ('FIXED','BY_ROLE','EACH_AGENT');
-- CREATE TABLE "EmailRule" / "EmailLog" (+ indexes, FKs)
ALTER TABLE "EmailRule" OWNER TO crm;   -- REQUIRED, rule 4
ALTER TABLE "EmailLog"  OWNER TO crm;   -- REQUIRED, rule 4
COMMIT;
```

`CREATE TYPE` is transaction-safe; there is no `ALTER TYPE ... ADD VALUE` here,
so unlike the CallLog migration the whole block can be wrapped.

### Environment — set on production

All six are in `/home/ubuntu/app/.env.local` (previous file backed up to
`~/backups/env.local.bak-*`). `CRON_SECRET` was generated on the box. Without
them the page shows an amber banner naming what is missing rather than failing
silently.

### Cron — installed and confirmed firing

```
*/5 * * * * /home/ubuntu/run-email-reports.sh
```

Verified in syslog at 17:55:01. Every five minutes is deliberate: the due check
is "at or after the scheduled minute", so a 09:02 rule is not missed, and the
period key stops it sending twice.

**The secret is not in the crontab.** cron writes the whole command line to
`/var/log/syslog`, so the first version — with `?token=…` in the crontab — put
the secret in a world-readable log. It now calls `~/run-email-reports.sh`
(mode 700), which reads the secret from the app env and passes it as an
`x-cron-secret` header. Verified: right header 200, wrong header 401.

**One gotcha worth remembering:** installing a crontab with
`( crontab -l | grep -v X ; echo NEW ) | crontab -` under `set -e` silently
writes an *empty* crontab, because `crontab -l` fails when none exists and `grep`
exits non-zero on empty input. It happened here and looked like success.

The uncommitted `.claude/settings.json` (local tool permissions) is deliberately
never committed, and this file is kept untracked so the repo and production can
never disagree by a docs-only commit.

---

## 16. Shipped on 2026-08-21, second release (`41b116f`)

### KPI scoring

Each KPI target can now carry a **points** value, and agents are scored against
it. Points are per KPI *per period*, because a daily target of 30 and a monthly
target of 600 are not worth the same.

| File | What changed |
|---|---|
| `prisma/schema.prisma` | `KpiTarget.points Int?` — nullable, so a KPI can be measured without being scored |
| `lib/kpi.ts` | `kpiScore(actual, target, points)` |
| `app/api/kpi/targets/route.ts` | GET returns per-KPI `scores`, a `totalScore` and the period's `maxScore`; PUT accepts `points` |
| `app/dashboard/super-admin/kpi/page.tsx` | A small **pts** box under each target, a **Score** column, per-KPI points under each cell, and an Export button |

**Scoring is pro-rata and capped** — Himanshu's choice when asked. Half the
target earns half the points; beating the target earns no more than the target
was worth. The cap keeps "max score" a real ceiling: without it, one agent
hammering a single easy KPI could out-score a colleague who hit everything.

Edge cases: a target of **0** counts as met (asking for none and getting none is
success, not a division by zero); a KPI with **no points** or **no target**
scores `null` and is excluded from `maxScore`, so it shows a gap rather than
dragging a total down; and the total is re-rounded after summing, because adding
one-decimal values repeatedly reintroduces float noise.

**Verified with Himanshu's own example** — Dialed Calls target 30 worth 15 pts —
across three seeded agents:

| Agent | Dialed | Connected | Talktime | Total |
|---|---|---|---|---|
| ZZ Full | 30/30 → **15** | 10/10 → 10 | 20/20 → 20 | **45 / 60** |
| ZZ Half | 15/30 → **7.5** | 5/10 → 5 | 20/20 → 20 | **32.5 / 60** |
| ZZ Zero | 0/30 → 0 | 0/10 → 0 | 0/20 → 0 | **0 / 60** |

`maxScore` was 60, correctly excluding Hot Leads, which had no target. Switching
period recomputes everything: a weekly target of 100 worth 40 pts scored the same
three agents 12 / 6 / 0.

**Export** is CSV, built client-side from what is on screen so the file can never
disagree with the table. Each KPI contributes three columns — achieved, target,
points earned — because a manager questioning a score needs to see how it was
reached, not just the total. Plus period, range, total, max and percentage.

**Restricted to SUPER_ADMIN, REPORTS and COUNSELLING_TL.** Verified both ways: a
Super Admin sees the button, a Counselling Agent does not.

**Counselling Agents do not see the points weighting at all.** The line drawn is
config versus outcome: the `pts` boxes, the `· N pts` hint in the achievement
header and the explanatory paragraph are all hidden from them, while their own
Score and earned points stay — that being the point of scoring someone. Hiding
the boxes but leaving the `· N pts` hint would have hidden nothing, since it is
the same number.

Verified by logging in as each role: Super Admin and Team Leader see 24 points
boxes (6 KPIs × 4 periods), the weighting hint, the explainer and Export; the
agent sees none of those four and still sees their Score.

Also fixed in passing: the KPI list described **Talktime** as "Follow-ups any
feedback logged in the period". The three dialer-fed sources added last release
had no case in the page's `describe()` and fell through to the feedback wording,
labelling the wrong data.

### DDL applied

Backup `crm-20260821-171228.sql.gz`. Column add only — inherits the table's
grants, so no `OWNER TO`, and no enum change, so transaction-safe.

```sql
BEGIN;
ALTER TABLE "KpiTarget" ADD COLUMN IF NOT EXISTS "points" INTEGER;
COMMIT;
```

Verified after: production's one existing target (Dialed Calls, DAILY, 300) kept
its value with `points` null, so nothing is scored until someone fills the boxes
in and `maxScore` reads 0 until then. Ownership check clean, no drift beyond the
known `Lead.id` default.

The uncommitted `.claude/settings.json` (local tool permissions) is deliberately
never committed, and this file is kept untracked so the repo and production can
never disagree by a docs-only commit.

---

## 17. Shipped on 2026-08-21, first release (`05d2d0b`, `94b3e33`, `192dcd5`)

### Dialer base URL drops the `:9011` port

`lib/dialshree.ts`. The default is now `https://dialer5.elisiontec.com` — same
host, standard HTTPS port. `DIALSHREE_BASE_URL` still overrides it and is unset
on production, so the new default takes effect on deploy.

Verified before changing: the portless host issues a valid Bearer token with the
existing credentials, and `/api/manual-dial` and `/api/external-hangup` both
respond. No live call was placed — that would ring a real number.

Worth noting for whoever asked: `:9011` was also working at the time of the
switch, so nothing was broken in between.

### Enter saves the follow-up instead of adding a newline

`components/leads/lead-detail-drawer.tsx`. An agent types a short remark and
moves on, so the newline was almost never wanted and reaching for the button cost
a second on every call.

**Shift+Enter still inserts a newline** for the occasional longer note — a plain
Enter saves, which is what was asked, and the escape hatch costs nothing.

Two guards, both deliberate:

- A keystroke while the save is already in flight is ignored, so holding Enter
  cannot fire duplicate submissions.
- An Enter that is **closing an IME composition** is left alone. For an agent
  typing in an Indic script that key press confirms a character rather than
  finishing input, and submitting there would cut the remark off mid-word.

Verified: Enter on an empty Remarks shows "Remarks are required" and sends
nothing; Shift+Enter produced `"line one\nline two"` with no request; a plain
Enter sent exactly **one** POST (201) and the stored remark kept its newline.

The test wrote a real feedback row to a real lead, so it was undone: the row was
deleted, the borrowed lead handed back to its agent, and `Lead.updatedAt` — which
feedback advances by design — reset to the lead's `createdAt`, the same
convention `scripts/backfill-lead-updated-at.js` uses when a lead has no
feedback. The exact prior value was not recoverable.

### Delivery-status lookup — the LMS API changed under us

**The endpoint now requires all seven parameters.** On 19 Aug a bare `phone`
returned the record and the error for an empty query read *"At least email, phone,
or kaap_id is required"*. It now returns **HTTP 400** with a validation array
naming every missing field. Confirmed by dropping one parameter at a time: each
of `kaap_id`, `email`, `phone`, `course_id`, `city_id`, `state_id`,
`counsellor_id` is individually mandatory.

**My code was hiding it.** Every non-success was collapsed into one friendly
message, so a 400 rejection displayed as *"The LMS has no client delivery
recorded for this phone and college yet"* — a statement about the lead when the
truth was that the CRM's request had been refused. That is why this went
unnoticed for two days.

| File | What changed |
|---|---|
| `lib/lms-api.ts` | `fetchLmsDeliveryStatus` takes the full seven-field query, pre-checks for missing values, and returns a `reason` of `NOT_FOUND` / `BAD_REQUEST` / `UPSTREAM_ERROR`. Handles `message` arriving as an array (validation) or a string (everything else) |
| `app/api/leads/[id]/delivery-status/route.ts` | Resolves the lead's city / state / course to LMS ids with the same cached helpers the integration push uses, derives `counsellor_id` from the assigned agent's employee-code digits, and echoes the queried values back |
| `components/leads/lead-profile-page.tsx` | A rejected lookup reads as a warning, not as "not delivered", and either state expands to show what was looked up |

**Verified against the real record** from Himanshu's Postman call: the CRM now
returns `status: success`, `leadConfirmation: Primary`, `lead_code: CRM100` and
the full `response_payload`. The three resolvers independently produce exactly
the ids that record holds — Jaipur → `4352`, Rajasthan → `29`, MBA/PGDM → `101`.

**The AND-filter caveat is now unavoidable and worth knowing.** Every parameter
narrows the match, so a lead **reassigned** since the push, or whose **city was
corrected**, reads as undelivered — verified both. There is no narrower query
left to fall back on. To make that diagnosable rather than mysterious, the
response echoes the values used and the card shows them on expand: a `cityId` of
`7219` where the delivery holds `4352` is then obvious at a glance.

Also verified: a lead missing its KAPP college id now says so by name
("Missing or unresolved here: college id (KAPP)") instead of claiming the client
never took the lead.

The uncommitted `.claude/settings.json` (local tool permissions) is deliberately
never committed, and this file is kept untracked so the repo and production can
never disagree by a docs-only commit.

---

## 18. Shipped on 2026-08-20, third release (`761042b`)

### College/Course Search reads `duration_type`

`lib/lms-api.ts` gains `duration_type` on `LmsCourseGroup` and `duration` on
`LmsCourse`; `app/dashboard/college-search/page.tsx` uses them.

The Duration column hardcoded "Yr / Yrs". Now the unit comes from the LMS.
Surveyed 95 course groups across 12 colleges: `duration_type` is **`Years`,
`Year`, `Months`, `Days`** — so the old label was simply wrong for anything not
measured in years. A live example: LPU's *BPT* is **5 Months**, previously
rendered "5 Yrs".

**The plural is recomputed, not echoed.** Their data contains both `1 + "Year"`
and `2 + "Year"`, so printing the field verbatim would show "2 Year". The unit is
singularised and re-pluralised from the number, which also handles `66 Months`
and `5.5 Years` correctly.

**With no `duration_type` the number is shown bare.** Inventing a unit on a fee
table a student is quoted from is worse than leaving it off. Did not occur in any
of the 95 sampled rows.

**Second, separate fix in the same change.** The per-course table was showing the
*group's* duration against every course row. Courses carry their own `duration`,
and it genuinely differs: LPU's B.Tech **group** reports `3 Years` while every
B.Tech **course** in it is `4 Years`. A counsellor quoting a course was reading
the wrong figure. Now each row uses its own value, falling back to the group's
only if the course has none.

Verified live end to end before deploy: the group table renders `3 Years`,
`5 Months`, `5 Years`; drilling into B.Tech renders `4 Years` per course. Verified
after deploy: `duration_type` is present in the built page and no hardcoded
`Yr`/`Yrs` template literal survives anywhere in the build.

The uncommitted `.claude/settings.json` (local tool permissions) is deliberately
never committed, and this file is kept untracked so the repo and production can
never disagree by a docs-only commit.

---

## 19. Shipped on 2026-08-20, second release (`77727d5`)

### Dialer base URL moved to `dialer5.elisiontec.com:9011`

`lib/dialshree.ts`. Was hardcoded three times to `dialer8.elisiontec.com`; now
one `BASE_URL` constant, overridable with **`DIALSHREE_BASE_URL`** so the next
host move needs no code change. A trailing slash in the env value is trimmed,
since otherwise every path would double up.

**Login moved with dial and hangup, deliberately.** The request named only
Calling and Hangup, but the bearer token is minted by one dialer instance and is
not accepted by another — dialling against `dialer5` with a token from `dialer8`
would fail on every call. Verified that `dialer5:9011/api/login` issues a valid
Bearer token with the existing credentials.

`DIALSHREE_BASE_URL` is **not set** on production, so the `dialer5:9011` default
applies. Set it only when the provider moves the tenant again.

**No live call was placed to test dialling** — that would ring a real number. The
endpoints respond and the login was verified; the first real agent call confirms
the rest. The old host was still accepting the same credentials at the time of
the move, so nothing was broken in the interim.

Verified after deploy: the built bundle for both `/api/dialer/call` and
`/api/dialer/hangup` contains `dialer5.elisiontec.com:9011`, and no reference to
`dialer8` survives anywhere in the build.

If Calling/Hangup were meant to move while login stayed on `dialer8`, this
becomes two constants instead of one — say so and I'll split it.

The uncommitted `.claude/settings.json` (local tool permissions) is deliberately
never committed, and this file is kept untracked so the repo and production can
never disagree by a docs-only commit.

---

## 20. Shipped on 2026-08-20, first release (`887e06c`)

### Call details on the lead, and a parser fix

The first parser followed DialShree's *documented* sample, which nests
`uniqueid` and `user` inside `dynamic_data`. The live feed sends `dynamic_data`
as an empty string and puts both at the **top level**, so every call was landing
with no `uniqueId` (a retry would have duplicated rather than updated) and no
`agentSeat` (attributed to nobody). Nothing was lost — the whole body is stored
verbatim, which is why the backfill could recover it.

| File | What changed |
|---|---|
| `lib/dialshree-webhook.ts` | Reads `uniqueid` / `user` from the top level **or** nested, tolerates `dynamic_data` being a string, and captures `call_status`, `term_reason`, `disposition_description`, `lead_id` |
| `prisma/schema.prisma` | `CallLog` gains `callStatus`, `connected`, `termReason`, `dispositionDescription`, `dialerLeadId` + an index on `connected` |
| `app/api/leads/[id]/calls/route.ts` | Returns the new fields, and **no longer sends `recordingUrl` to the browser** — just `hasRecording` |
| `app/api/leads/[id]/calls/[callId]/recording/route.ts` | **New.** Streams the recording through the CRM |
| `components/leads/lead-detail-drawer.tsx` | Calls tab rebuilt: when, connected or not, talk time, attempt number, inline player |
| `lib/reports.ts`, `lib/kpi.ts` | "Connected" now means the dialer's own verdict, not talk time > 0 |
| `scripts/backfill-call-logs.js` | **New.** Re-parses stored rows from `payload` |

**Their `call_status` disagrees with talk time.** A live call came through as
`NOT CONNECTED` with `talk_time: "00:07"`. The dialer's verdict is authoritative,
so `connected` is normalised from `call_status` and only falls back to the clock
when no status is sent. Averaging on talk time alone would have over-counted.

**Recordings are proxied, not linked.** Three reasons, all verified against the
live dialer: it serves them as `Content-Type: application/forcedownload`, which
browsers download instead of playing; its URLs need **no authentication at all**,
so anyone holding one can fetch a student's call; and the URL path spells out the
phone number and campaign. The proxy re-labels as `audio/mpeg`, applies
`canAccessLead`, passes `Range` through so the player can seek, and restricts
fetches to `*.elisiontec.com` over HTTPS. Verified: 200 full, 206 with a Range
header, 401 unauthenticated.

The player is mounted only after a click, so a lead with twenty calls does not
open twenty connections to the dialer on render.

### DDL applied

Backup `crm-20260820-060354.sql.gz`. Column adds only — they inherit the table's
grants, so no `OWNER TO`, and no enum change, so the whole block is
transaction-safe.

```sql
BEGIN;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "callStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "connected" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "termReason" TEXT,
  ADD COLUMN IF NOT EXISTS "dispositionDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "dialerLeadId" TEXT;
CREATE INDEX IF NOT EXISTS "CallLog_connected_idx" ON "CallLog"("connected");
COMMIT;
```

### Backfill run

```bash
node scripts/backfill-call-logs.js --apply   # after a dry run
```

**All 5 production rows recovered**: `uniqueId`, seat `100096`, `call_status`,
`connected`, `term_reason`, disposition and the dialer's own lead id, and every
one matched to Shubham Rajput. No duplicate `uniqueid` clashes. They remain
lead-less, correctly — see the note below.

Fills only gaps, never overwriting a value a later correct webhook wrote. It
re-attempts the lead and agent matches that failed purely because the seat was
missing, and reports rather than merges any two rows that turn out to be the same
dialer `uniqueid` — those would violate the unique index.

Verified after deploy by posting a payload shaped like the real one — flat, with
`dynamic_data` as an empty string. The new parser captured `uniqueid` and the
seat, matched the agent, and a second POST of the same `uniqueid` left one row
rather than two. A direct query confirms Reports will now show Shubham Rajput
with 2 connected calls averaging 0.2 minutes.

**Note on the rows already on production:** none matched a lead, because
`9644460737` and `9601103894` are not leads in the production database — those
were test calls to numbers the CRM does not hold. That part is not a bug. After
the backfill they will still be lead-less but will at least be attributed to the
agent who made them.

### Unmatched calls are no longer invisible

`lib/call-log-matching.ts` (**new**) defines what it means for a call to belong
to a lead, and both `…/calls` and `…/calls/[callId]/recording` use it.

A call qualifies if the webhook matched it at write time **or** if it has no lead
at all and its number is this lead's number. The second case matters because the
webhook can only match against leads that exist *when the call lands* — a call
placed before the lead was created, or one whose match failed because the number
was corrected afterwards, would otherwise sit in the table invisible forever.
Reading by number makes the history appear the moment the lead does, with no
backfill needed.

Only rows with **no** lead are pulled in this way, so a call already attributed
to another lead never shows against this one.

Verified: a lead on `9644460737` sees both `leadId = NULL` calls, a lead on a
different number sees none, Play returns `200 audio/mpeg` on an unmatched call,
and another lead asking for that same call's recording gets 404.

The uncommitted `.claude/settings.json` (local tool permissions) is deliberately
never committed, and this file is kept untracked so the repo and production can
never disagree by a docs-only commit.

---

## 21. Shipped on 2026-08-19, second release (`800a0f1`, `c26326f`)

### A `{{digits(field)}}` template helper

`lib/lead-integration-template.ts`. Strips every non-digit, so
`{{digits(assignedTo_employeeCode)}}` sends `1005` where
`{{assignedTo_employeeCode}}` sends `EMP-1005`. Asked for on 19 Aug: the
receiving system wants a bare numeric counsellor id.

Done as a helper rather than a second "employee number" field so it works on any
field, not just this one.

**The same commit removes a duplicated helper set.** `resolveToken` (JSON body)
and `renderText` (headers, URL, query params) each had their own copy of the
helper switch, so a helper added to one would have worked in the body and
silently emitted an empty string in a header. Both now route through one
`applyHelper`.

Verified: `EMP-1005 → 1005`, `EMP1005 → 1005`, `emp-0007 → 0007` (leading zero
kept, it is a string), `ZZSA → ""`, null/missing → `""`, unknown helper still
fails closed to `""`, and the helper appears in the builder's syntax list
automatically.

### Client delivery status on a referral — code only, no schema change

The CRM's push log only ever proved the *LMS* accepted a referral ("HTTP 200").
The LMS then forwards it to the client's own API, and the client's answer — was
this taken as a Primary lead? — lived only in the LMS. Each referral card now
shows it.

| File | What changed |
|---|---|
| `lib/lms-api.ts` | New `fetchLmsDeliveryStatus`, same 8s-timeout pattern as the existing LMS calls but `cache: 'no-store'` |
| `app/api/leads/[id]/delivery-status/route.ts` | **New.** Gated on `canAccessLead`, so a counsellor cannot read the status of a lead they cannot see. 502 on an unreachable LMS |
| `components/leads/lead-profile-page.tsx` | New `ReferralDeliveryStatus` row under the existing push status — collapsed one-liner, expands to the client's response and what the LMS sent |

**Read live, never stored.** The outcome changes as the LMS retries, so a saved
snapshot would go quietly stale. A 60s `staleTime` keeps step-to-step navigation
inside the profile from re-hitting the LMS.

**Only `phone` and `kaap_id` are sent, and that is deliberate.** Verified against
the live endpoint: **every parameter is an AND filter** — a correct phone with
one wrong `city_id` returns "No delivery log found". Sending the lead's current
city, course or counsellor would therefore turn any later correction to those
fields into a false "not delivered". Only the two values that identify what was
actually pushed go out.

**"Nothing matched" arrives as HTTP 200 with `success: false`,** so the body is
inspected rather than the status code — trusting the code would read every
not-found as a hit.

The row only renders once a real (non-test) push has succeeded; before that there
is no downstream delivery to report.

Three states, all verified: found (status + Primary badge + payloads), not found
(plain-English message, not the upstream's developer text), and LMS unreachable
(distinct from "not delivered", which would be a claim about the lead rather than
about the lookup). Access control verified: an agent asking about someone else's
lead gets 404, unauthenticated gets 401.

**Security note for Himanshu, not a code change:** the delivery-status endpoint
returned data with **no `x-api-key` header at all**. Anyone who knows a phone
number can read that lead's delivery log, request payload and client response.
That is an LMS-side gap worth raising with whoever owns that API.

### Click-to-call on the lead profile page — code only, no schema change

The profile page's Call button was a plain `tel:` link — it handed the number to
the device's phone app instead of going through the dialer, so those calls never
rang the agent's seat and never reached DialShree.

| File | What changed |
|---|---|
| `lib/hooks/use-click-to-call.ts` | **New.** The dialer logic, extracted once |
| `components/leads/lead-detail-drawer.tsx` | Now consumes the hook; ~50 lines of duplicated mutation code deleted, behaviour unchanged |
| `components/leads/lead-profile-page.tsx` | `tel:` anchor replaced with the same Call / Disconnect Call pair |

**Extracted rather than copied.** Pasting the drawer's 50 lines into the profile
page would have created a second copy to keep in step — exactly the trap the
duplicated template-helper switch was.

Verified on both surfaces: the `tel:` link is gone, the button is a real
`<button>`, `POST /api/dialer/call` fires, and an unlinked account gets the same
409 `NO_DIALER_ID` toast in the drawer and on the profile page.

**The successful-dial path is untested, deliberately.** Completing it would place
a real call through DialShree to a real student's phone. The `onSuccess` handler
that flips the button to Disconnect is the drawer's existing production code,
unchanged — but it has not been exercised from the profile page.

### DialShree post-call webhook

The dialer now pushes call data back after every call, which finally gives the
CRM talk time and recordings. Integration details to hand DialShree live in
`DIALSHREE-WEBHOOK.md`.

| File | What changed |
|---|---|
| `prisma/schema.prisma` | New `CallLog` model; three new `KpiSource` values |
| `lib/dialshree-webhook.ts` | **New.** Payload normalisation, kept apart from the route so it can be tested directly |
| `app/api/webhooks/dialshree/call/route.ts` | **New.** Secret-authenticated, no session. Returns `{"status":true}` |
| `app/api/leads/[id]/calls/route.ts` | **New.** A lead's dialer calls, gated on `canAccessLead` |
| `components/leads/lead-detail-drawer.tsx` | The Calls tab's "TODO: fetch recordings" placeholder is now a real call history |
| `lib/reports.ts` | Avg Talktime is real — it read "no data" before |
| `lib/kpi.ts` | Three dialer sources; the *Talktime* starter now defaults to a measurable one |
| `DIALSHREE-WEBHOOK.md` | **New.** The handover document |

**The DDL ran in two steps, and had to.** `ALTER TYPE ... ADD VALUE` cannot run
inside a transaction (procedure rule 3), so the three enum values went first
under psql autocommit, then the table in its own `BEGIN/COMMIT`. Applied on
2026-08-19 against PostgreSQL 18.4, backup `crm-20260819-154424.sql.gz`.

```sql
-- Standalone, NO transaction:
ALTER TYPE "KpiSource" ADD VALUE IF NOT EXISTS 'CALL_TALKTIME_MINUTES';
ALTER TYPE "KpiSource" ADD VALUE IF NOT EXISTS 'CALL_COUNT';
ALTER TYPE "KpiSource" ADD VALUE IF NOT EXISTS 'CALL_CONNECTED_COUNT';
-- Then CREATE TABLE "CallLog" (+ 4 indexes, 1 unique index, 2 FKs) and:
ALTER TABLE "CallLog" OWNER TO crm;   -- REQUIRED, rule 4
```

**`DIALSHREE_WEBHOOK_SECRET` is set on production**, generated on the box with
`openssl rand -hex 32` and appended to `/home/ubuntu/app/.env.local` (backup of
the previous file in `~/backups/env.local.bak-*`). The endpoint returns 503
without it. The live URL is in `DIALSHREE-WEBHOOK.md`; treat it as a credential.

**Timezone trap handled.** The dialer's timestamps carry no zone and are IST
wall-clock, and one payload contains two formats —
`2026-07-13T12:18:53` and `2026-07-13 02:18:36`. `istWallClockToInstant` only
matches the `T` form; the space form would fall through to `new Date()`, which
reads it in the *process* zone. That looks correct on an IST laptop and is wrong
by 5:30 on the UTC server. `parseDialerTimestamp` normalises the separator
first. Verified under `TZ=UTC`: 12:18:53 → `06:48:53Z`.

**Verified end to end on production** after the deploy, and before that locally: 401 without the secret, 401
with a wrong one, 200 + `{"status":true}` with it (query param *and* header),
lead matched by phone, agent matched by dialer seat, a repeated `uniqueid`
updating rather than duplicating, unmatched calls stored rather than dropped,
400 with a clear reason for non-JSON / missing / short phone numbers, IST stored
correctly, Reports showing `3.3` avg minutes, the KPI reading `3` of a 10-minute
target, and the Calls tab listing the call with its recording link.

**⚠ Still to do — one manual step.** Production's *Talktime* KPI may already be
seeded as `NOT_MEASURED`. The new default only applies to a fresh seed, so edit
it in KPI Targets and pick **Talk time (minutes)**, or run:

```sql
UPDATE "KpiDefinition" SET source = 'CALL_TALKTIME_MINUTES'
 WHERE name = 'Talktime' AND source = 'NOT_MEASURED';
```

The uncommitted `.claude/settings.json` (local tool permissions) is deliberately
never committed, and this file is kept untracked so the repo and production can
never disagree by a docs-only commit.

---

## 22. Shipped on 2026-08-19, first release (`c3a7d87`, `6e8bdf1`)

### KPI targets — user-defined

KPIs are **configuration, not code**: a Super Admin creates them from the page,
choosing what each one counts. Targets are organisation-wide, one per KPI per
period, and every agent is scored against the same numbers.

**The six sources a KPI can use:** feedback logged; distinct leads with that
feedback; leads currently at a Lead Stage (a live count, ignores the period);
approved receipts of a type (by date paid); leads assigned in the period; and
"not measured" for a target with no data behind it.

Feedback KPIs narrow by **specific options and/or whole categories, OR'd
together** — so "anything Connected, plus Walk-In" is one KPI. Leaving both
empty counts every feedback.

**The six starters** (Dialed Calls, Connected Calls, Hot Leads, Warm Leads, Paid
Apps, Talktime) seed on a Super Admin's first visit and are ordinary
definitions — editable and deletable. Seeding only runs when there are none at
all, so a deliberately emptied list will not regrow.

Only a Super Admin may create, edit or delete KPIs or set targets. Everyone else
reads: SA/REPORTS see every agent's achievement, a TL their own agents, an agent
themselves.

Weeks are Monday–Sunday and quarters are **calendar** quarters (not the Indian
financial year), both on IST dates. Each window runs to the **end** of its
period, so a Wednesday reading of a Weekly target is 3 days of work against a
7-day expectation — it answers "on track?", not "on pace?".

### Reports & Performance — split into two submenus

**Performance Analysis** is the old page, unmoved on disk. **Reports** is new
and renders three ways from one endpoint: an agent sees themselves, a TL their
team, SA/REPORTS/Operations everyone. Scope comes from the session, never the
query string, so the filters can only *narrow* what a session already permits.

**Both filters are multi-select**, reusing `components/shared/multi-select-filter.tsx`
unchanged — the same searchable checkbox popover as the All Leads filter bar.
Picking a Team Leader narrows the Agent list to that TL's agents, because the
server builds the choices from the same where-clause as the report itself.

**Team totals follow the TL filter but ignore the Agent filter.** Selecting one
agent out of a team should not silently redefine the team; selecting a TL
genuinely changes which team is being totalled.

**Where each number comes from:** Dialed Calls is every feedback logged;
Connected / Not Connected split on the **Connected** and **Not Connected**
feedback *categories*, so re-categorising an option in Manage Feedback moves the
number with it. Applications and Admissions are approved receipts of that type
counted **by date paid**, not date approved. A working day is a day the agent
punched in at all, counted distinct.

**Average Talktime shows "—", not 0.** Nothing records call duration; a zero
would read as "this agent talked to nobody", which is a different and unfair
claim. It fills in if the dialer's CDR is ever ingested.

**No revenue anywhere** — removed at Himanshu's request on 19 Aug. `amountPaid`
is what the student paid the college, not what the business earns, and the
per-application / per-admission costing is not known.

### Lead Integrations — the assigned agent is pushable

A new **Assigned Agent** group in the field picker: `assignedTo_name` (same key
as before, so saved templates are unaffected) plus `assignedTo_employeeCode`,
`assignedTo_id`, `assignedTo_email`, `assignedTo_dialshreeId`.

There is no single "agent id", so each identifier is offered separately.
Employee Code is the one to use for an external system; `assignedTo_id` is this
CRM's own primary key and means nothing outside it.

On an unassigned lead all five are null, which the renderer writes as an empty
string — use `{{default(assignedTo_employeeCode, UNASSIGNED)}}` for a
placeholder.

### Database changes applied

Backup taken first: `~/backups/crm-20260819-081319.sql.gz` (993K, gzip-verified).

```sql
BEGIN;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "zone" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "language" TEXT;
-- CREATE TYPE "KpiSource" / "KpiPeriod"  (guarded with DO $$ … duplicate_object)
-- CREATE TABLE "KpiDefinition" / "KpiTarget"  (+ 3 indexes, 3 FKs)
ALTER TABLE "KpiDefinition" OWNER TO crm;
ALTER TABLE "KpiTarget"     OWNER TO crm;
COMMIT;
```

Verified after: both tables owned by `crm`, no table in `public` owned by anyone
else, both enums present with the right labels, `zone`/`language` nullable TEXT,
`has_table_privilege('crm', …)` true, and the pm2 error log untouched since
before the deploy.

---

## 23. Deployment procedure

Learned the hard way; each step exists because something went wrong without it.

1. **`pg_dump` first.** `sudo -u postgres pg_dump counselling_crm | gzip > ~/backups/crm-$(date +%Y%m%d-%H%M%S).sql.gz`, then `gunzip -t` it and `chmod 600`. `~/backups` is `700`.
2. **Run the DDL before deploying the code.** The new Prisma client reads columns/enum values the database must already have. Deploying first means live errors until the migration lands.
3. **`ALTER TYPE ... ADD VALUE` cannot run inside a transaction.** Run those standalone under psql autocommit — never wrapped in `BEGIN/COMMIT`. Pure `CREATE TABLE`/`ALTER TABLE`/`CREATE INDEX` migrations *can* and should be wrapped.
4. **Create new tables as the `crm` role, or transfer ownership in the same breath.**
   ```sql
   ALTER TABLE "NewTable" OWNER TO crm;
   ```
   *This broke production on 2026-08-18.* `LeadStageEntry` was created with
   `sudo -u postgres`, so it was owned by `postgres`; the app connects as `crm`
   and every lead query failed with `permission denied for table
   LeadStageEntry` — All Leads showed 0 while the category chips still worked.
   `ALTER TABLE ... ADD COLUMN` is NOT affected (it inherits the table's
   grants). Check afterwards: `select tablename, tableowner from pg_tables where schemaname='public' and tableowner <> 'crm'` must return nothing.
5. **Add `IF NOT EXISTS` guards** (and `DO $$ … EXCEPTION WHEN duplicate_object` for types and constraints) so a re-run cannot half-fail, and verify the end state explicitly rather than trusting the command output.
6. **Build locally before pushing** (`npm run build`). The box has 1GB RAM and a failed remote build costs ~8 minutes.
7. **Commit, push, then** `gh workflow run "Deploy to AWS" --ref main`. Manual dispatch only; it runs `git pull && npm ci && npx prisma generate && npm run build && pm2 restart crm`. Takes ~8 minutes.
8. **Verify after:** deployed commit matches, `pm2` online, the regenerated client contains any new model/field (`grep X node_modules/.prisma/client/schema.prisma`), `migrate diff` reports no drift, ownership check empty, live site 200, and **the modification time of `~/.pm2/logs/crm-error.log`** — a stale timestamp is the fastest proof nothing new is failing.

**Access:** `ssh -i ~/Downloads/crm-key.pem ubuntu@13.206.157.201`, app at
`/home/ubuntu/app`. `migrate diff` on the box needs the env loaded first
(`set -a; . ./.env.local; set +a`) or it fails with "Environment variable not
found: DATABASE_URL".

**Known, pre-existing drift:** `migrate diff` always reports
`ALTER TABLE "Lead" ALTER COLUMN "id" SET DEFAULT ('LID' || nextval('lead_id_seq'))`.
That is the custom LID sequence, deliberately not expressed in the Prisma
schema. Expect that one line; anything else is real drift.

### Git hygiene

`git add -p` is unavailable here, so when one file (usually `prisma/schema.prisma`)
carries changes belonging to two features, write a reduced version of the file,
commit the first group, then restore the full version and commit the second.
Staged deletions from an earlier `git rm` will otherwise ride along into whichever
commit runs first.

### Local dev gotchas

- Never share one `.next` between `npm run build` and `npm run dev` — it corrupts the dev cache and every API route 404s (including `/api/auth/*`, which then looks like a login failure). Stop the server, `rm -rf .next`, restart.
- Check the dev server actually took port 3000. If an orphan is holding it, `next dev` silently moves to 3001 and you end up testing the stale one. `pkill -f "next dev"; lsof -ti:3000 | xargs kill -9`.
- Automated login must wait for hydration. Clicking submit too early does a native GET and lands on `/login?email=…&password=…` instead of signing in.

---

## 24. Deliberately NOT run — waiting on a decision

Both are read-only unless given `--apply`, and neither has been run against
production.

- **`scripts/backfill-lead-updated-at.js`** — `Lead.updatedAt` only advances on
  feedback now, but rows written before that change still carry timestamps from
  incidental writes; a large block sits in three buckets from 14 Aug 15:16–15:17
  (the fingerprint of a bulk team reassignment). Rewrites them to the latest
  feedback time, or the lead's own `createdAt` where there is none.
- **`scripts/backfill-lead-stage-history.js`** — leads created before
  `LeadStageEntry` existed have no starting point, so their timeline begins
  mid-way. Seeds the current stage as entry one at the lead's `createdAt`
  (`source='MIGRATED'`) and recovers an earlier stage from the stage-change
  activity log's `metadata.from` where one exists. Himanshu asked to deploy
  without it on 2026-08-18.

---

## 25. Live — needs configuration or a decision, not code

- **No user has a Zone or Language set.** Both are new and nullable, so the
  Reports page shows "—" in those two columns until User Management is filled
  in. Nothing else depends on them.
- **KPI targets are empty on production.** The six starter *definitions* seed
  themselves on a Super Admin's first visit to KPI Targets, but every target is
  blank until someone types numbers in, and the Reports benchmarking panel stays
  empty until then.
- **No college has a Zone or Deal Type set (0 of 17).** Until an admin fills
  them in via Manage Colleges, newly ingested leads carry neither. Existing
  leads are untouched, so the Deal Type filter shows a mix of the old
  Admission/Application values and the new Branding/CPL/CPA/CPS ones.
- **No agent is mapped to a dialer seat** — `dialshreeId` is NULL for every
  user, so the Call button reports "not linked" until User Management is filled
  in. This also means the new `{{assignedTo_dialshreeId}}` integration field is
  empty for everyone. No live test call has been placed either, which would also
  settle whether the hangup API's `value` is a constant or a call handle.
- **DialShree credentials should be rotated** — they passed through a chat
  transcript, and so did a live bearer token minted during the `dialer5` host
  check on 20 Aug. Revoking existing API tokens matters more than the password:
  tokens are minted per login and survive a password change.
- **`DIALSHREE_BASE_URL` is unset**, so the dialer host falls back to the
  `dialer5.elisiontec.com:9011` default compiled in. Set it in `.env.local` and
  restart when the provider moves the tenant again — no deploy needed.
- **Lead Stage is validated strictly** against `Hot, Warm, Cold, Submitted,
  Untouched, Not Reachable, Closed`, matched exactly and case-sensitively.
  Anything else from the upstream feed is rejected with a 400.
- **Mark as Done appears only on the Overdue tab.** Upcoming calls are still
  completed by submitting feedback.
- **The 282 surplus lead rows from the 22 Aug upload are still in production.**
  The importer no longer creates them, but the existing ones remain, with 147
  feedbacks and 129 calls spread across them. Cleaning up means deciding which
  copy survives where several have activity — needs a backup and sign-off.
- **No email rules exist yet.** The scheduler runs every five minutes and does
  nothing until someone adds a rule on Configurations → Email Automation.
- **The CRM has no HTTPS** (port 443 refused). Blocks proper PWA install and any
  browser-based softphone, since microphone access needs a secure context.

### Open questions

- Should **quarters** be the Indian financial year (Apr–Mar, Q1 = Apr–Jun)
  rather than calendar? Jul–Sep is currently labelled Q3; on the FY calendar the
  same months are Q2.
- Should the KPI/Reports windows measure **to-date with a pro-rated target**
  ("on pace?") instead of the full period ("on track?")?
- Two local-only feedback options (`Call Back`, `Not Interested`) near-duplicate
  production's `Callback` / `Not Intrested` — remove them locally?
- `/api/reports/performance` is dead code; nothing calls it. Remove?
- Historic `Admission` / `Application` dealType values predate the new
  Branding/CPL/CPA/CPS list — map them or leave them?
