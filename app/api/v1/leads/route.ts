import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DropdownType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { verifyApiKey } from '@/lib/api-key';
import { fetchLmsCityNames, fetchLmsStateNames, fetchLmsCourseNames, toCanonicalMap } from '@/lib/lms-api';
import { buildDropdownValidationSets, isAllowedDropdownValue, type DropdownValidationSets } from '@/lib/dropdown-validation';

// ═════════════════════════════════════════════════════════════════════════
// POST /api/v1/leads — External Lead Ingestion API
// ═════════════════════════════════════════════════════════════════════════
//
// Lets an external system (partner LMS, referral site, landing-page backend,
// etc.) push leads directly into this CRM. Accepts EITHER a single lead
// object (original format, response unchanged for backward compatibility)
// OR a JSON array of up to 500 lead objects in one call — use the array
// form to push many leads without hitting this endpoint once per lead.
//
// Unlike CSV upload / Single Add Lead, a lead created here SKIPS Lead
// Approvals entirely: it's created with status APPROVED and no assignee, so
// it lands straight in the Unassigned Leads pool on the Assign Leads page,
// ready for a Team Lead to pick up. Nothing here ever pre-assigns a lead to
// a specific agent — "unassigned" always means exactly that.
//
// AUTH
//   Authorization: Bearer <api_key>
//   Generate/revoke keys under Super Admin → Configurations → API Keys.
//   A request with a missing, malformed, unknown, or revoked key gets 401.
//
// REQUEST BODY (application/json) — a single object, OR an array of objects
//   Every field below is REQUIRED on each lead object. A lead missing any of
//   them, or with a value that fails its check, is rejected — the array form
//   reports failures per item and still creates everything else that's valid.
//
//   interface LeadIngestPayload {
//     name: string;               // full name
//     email: string;              // must be a syntactically valid email
//     phone: string;               // exactly 10 digits, e.g. "9876543210"
//     city: string;                 // must exactly match (case-insensitive) a city name
//                                    // from the same location API this CRM's UI uses
//     state: string;                // must exactly match (case-insensitive) a state name
//                                    // from that same location API
//     course: string;               // must exactly match (case-insensitive) a course name
//                                    // from that same provider's course list
//     kappCollegeId: string;        // must match a College's "KAPP College ID" configured
//                                    // under Manage Colleges — resolves to that college
//     leadCode: string;             // free text, stored as this lead's "Lead Code"
//                                    // (shown as the Campaign/Lead Code column in the UI)
//     leadType: string;             // must match a value configured under
//                                    // Manage Dropdowns → Lead Type
//     leadOrigin: string;           // must match Manage Dropdowns → Lead Origin
//     leadConfirmation: string;     // must match Manage Dropdowns → Lead Confirmation
//     leadStage: string;            // must match Manage Dropdowns → Lead Stage
//     leadVerification: string;     // must match Manage Dropdowns → Lead Verification
//     dataCallingType: string;      // must match Manage Dropdowns → Data Calling Type
//     dealType: string;             // must match Manage Dropdowns → Deal Type
//     createdAt: string;            // format: "yyyy-mm-dd" — the lead's original creation
//                                    // date on your side (stored separately from this CRM's
//                                    // own audit timestamp, which always reflects when the
//                                    // record was actually inserted here)
//   }
//
//   Dropdown fields (leadType / leadOrigin / leadConfirmation / leadStage /
//   leadVerification / dataCallingType / dealType) match case-sensitively
//   against the exact values configured in Manage Dropdowns. Exception: if a dropdown
//   type has no values configured there AT ALL yet, that field is accepted
//   as free text (there's nothing to validate against) — configure it in
//   Manage Dropdowns once you want that specific field enforced.
//
//   Duplicates (email + resolved college, case-insensitive) are checked both
//   against leads already in the CRM AND against earlier items in the same
//   array — sending the same lead twice in one call only creates it once.
//
// RESPONSES — single-object request body (unchanged)
//   201 Created      — lead accepted, created APPROVED and unassigned
//     { "success": true, "message": "Lead Processed Successfully", "Lead_ID": "LID50" }
//
//   409 Conflict      — a lead with this email + college already exists
//     { "success": false, "message": "Duplicate lead...", "Lead_ID": "LID12" }
//     (Lead_ID here is the ALREADY-EXISTING lead's ID, for your reference)
//
//   400 Bad Request    — one or more fields were missing or failed validation
//     { "success": false, "message": "Validation failed", "errors": { "<field>": "<reason>", ... } }
//
// RESPONSES — array request body
//   201 Created (at least one lead was created) or 400 Bad Request (none were)
//     {
//       "success": true,
//       "message": "Processed 3 leads — 2 created, 1 duplicate, 0 failed",
//       "summary": { "total": 3, "created": 2, "duplicate": 1, "failed": 0 },
//       "results": [
//         { "index": 0, "success": true,  "message": "Lead Processed Successfully", "Lead_ID": "LID101" },
//         { "index": 1, "success": true,  "message": "Lead Processed Successfully", "Lead_ID": "LID102" },
//         { "index": 2, "success": false, "message": "Duplicate lead...", "Lead_ID": "LID101" }
//       ]
//     }
//   Each entry in "results" is shaped exactly like a single-object response,
//   plus its "index" (0-based position) in the array you sent — a failed
//   validation entry there has "errors" instead of "Lead_ID", same as above.
//   Max 500 leads per call — send more in a second request.
//
// RESPONSES — either form
//   401 Unauthorized    — missing / malformed / unknown / revoked API key
//     { "success": false, "message": "Missing or invalid API key" }
//
//   500 Internal Server Error — unexpected failure on our side
//     { "success": false, "message": "Internal server error" }
//
// Note on status codes: this deliberately uses standard REST semantics
// (201 = created, 409 = conflict, 400 = validation, 401 = auth) rather than
// ad-hoc codes, so any standard HTTP client / API gateway on your side
// handles it correctly without special-casing.
// ═════════════════════════════════════════════════════════════════════════

const MAX_BULK = 500;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidCalendarDate(yyyyMmDd: string): boolean {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const req1 = (label: string) => z.string().trim().min(1, `${label} is required`);

const payloadSchema = z.object({
  name: req1('name'),
  email: z.string().trim().min(1, 'email is required').email('Must be a valid email address'),
  phone: z.string().trim().min(1, 'phone is required').regex(/^\d{10}$/, 'Phone must be exactly 10 digits'),
  city: req1('city'),
  state: req1('state'),
  course: req1('course'),
  kappCollegeId: req1('kappCollegeId'),
  leadCode: req1('leadCode'),
  leadType: req1('leadType'),
  leadOrigin: req1('leadOrigin'),
  leadConfirmation: req1('leadConfirmation'),
  leadStage: req1('leadStage'),
  leadVerification: req1('leadVerification'),
  dataCallingType: req1('dataCallingType'),
  dealType: req1('dealType'),
  createdAt: z
    .string()
    .trim()
    .min(1, 'createdAt is required')
    .regex(DATE_RE, 'createdAt must be in yyyy-mm-dd format')
    .refine(isValidCalendarDate, 'createdAt is not a valid calendar date'),
});

type LeadPayload = z.infer<typeof payloadSchema>;

function fail(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...extra }, { status });
}

function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

// ── Shared cross-reference validation (city/state/course/college/dropdowns) ──
// Resolves free-text values against the LMS location provider + Manage
// Dropdowns, case-insensitively. Pure/in-memory — the LMS names and dropdown
// sets are fetched once per request (not once per lead) and passed in.

interface ResolvedFields {
  city?: string;
  state?: string;
  course?: string;
  college?: string;
}

interface CrossRefMaps {
  cityMap: Map<string, string>;
  stateMap: Map<string, string>;
  courseMap: Map<string, string>;
  dropdownData: DropdownValidationSets;
}

function resolveAndValidate(d: LeadPayload, maps: CrossRefMaps): { errors: Record<string, string>; resolved: ResolvedFields } {
  const errors: Record<string, string> = {};
  const resolved: ResolvedFields = {};

  const canonicalCity = maps.cityMap.get(d.city.toLowerCase());
  if (!canonicalCity) errors.city = `"${d.city}" does not match any known city`;
  else resolved.city = canonicalCity;

  const canonicalState = maps.stateMap.get(d.state.toLowerCase());
  if (!canonicalState) errors.state = `"${d.state}" does not match any known state`;
  else resolved.state = canonicalState;

  const canonicalCourse = maps.courseMap.get(d.course.toLowerCase());
  if (!canonicalCourse) errors.course = `"${d.course}" does not match any known course`;
  else resolved.course = canonicalCourse;

  const canonicalCollege = maps.dropdownData.collegeIdMap.get(d.kappCollegeId.toLowerCase());
  if (!canonicalCollege) errors.kappCollegeId = `"${d.kappCollegeId}" is not a valid KAPP College ID`;
  else resolved.college = canonicalCollege;

  const checkDropdown = (type: DropdownType, value: string, field: string, label: string) => {
    if (!isAllowedDropdownValue(maps.dropdownData, type, value)) {
      errors[field] = `"${value}" is not a configured ${label} value`;
    }
  };
  checkDropdown(DropdownType.LEAD_TYPE, d.leadType, 'leadType', 'Lead Type');
  checkDropdown(DropdownType.LEAD_ORIGIN, d.leadOrigin, 'leadOrigin', 'Lead Origin');
  checkDropdown(DropdownType.LEAD_CONFIRMATION, d.leadConfirmation, 'leadConfirmation', 'Lead Confirmation');
  // Validated against Manage Dropdowns -> Lead Stage like every other dropdown
  // field: an unconfigured value is rejected rather than created on the fly, so
  // an admin stays in control of the list and a typo upstream cannot quietly
  // add a new stage.
  checkDropdown(DropdownType.LEAD_STAGE, d.leadStage, 'leadStage', 'Lead Stage');
  checkDropdown(DropdownType.LEAD_VERIFICATION, d.leadVerification, 'leadVerification', 'Lead Verification');
  checkDropdown(DropdownType.DATA_CALLING_TYPE, d.dataCallingType, 'dataCallingType', 'Data Calling Type');
  checkDropdown(DropdownType.DEAL_TYPE, d.dealType, 'dealType', 'Deal Type');

  return { errors, resolved };
}

function dedupeKey(email: string, college: string | null): string {
  return `${email.toLowerCase()}|${(college ?? '').toLowerCase()}`;
}

export async function POST(req: NextRequest) {
  try {
    // ── Authentication ──────────────────────────────────────────────────
    const apiKey = await verifyApiKey(req.headers.get('authorization'));
    if (!apiKey) return fail(401, 'Missing or invalid API key');

    // ── Shape validation ────────────────────────────────────────────────
    const body = await req.json().catch(() => null);
    if (body === null) return fail(400, 'Request body must be valid JSON');

    const isBulk = Array.isArray(body);

    // ── Cross-reference data — fetched ONCE per request, reused for every
    // lead in the array, instead of once per lead ──────────────────────────
    const [cityNames, stateNames, courseNames, dropdownData] = await Promise.all([
      fetchLmsCityNames().catch(() => null),
      fetchLmsStateNames().catch(() => null),
      fetchLmsCourseNames().catch(() => null),
      buildDropdownValidationSets(),
    ]);
    if (cityNames === null || stateNames === null || courseNames === null) {
      return fail(502, 'Could not verify city/state/course against the location provider — please retry');
    }
    const maps: CrossRefMaps = {
      cityMap: toCanonicalMap(cityNames),
      stateMap: toCanonicalMap(stateNames),
      courseMap: toCanonicalMap(courseNames),
      dropdownData,
    };

    // ═══════════════════════════════════════════════════════════════════
    // Single-object request — unchanged behavior/response shape
    // ═══════════════════════════════════════════════════════════════════
    if (!isBulk) {
      const parsed = payloadSchema.safeParse(body);
      if (!parsed.success) return fail(400, 'Validation failed', { errors: fieldErrorsFromZod(parsed.error) });
      const d = parsed.data;

      const { errors, resolved } = resolveAndValidate(d, maps);
      if (Object.keys(errors).length > 0) return fail(400, 'Validation failed', { errors });

      const email = d.email.toLowerCase();
      const college = resolved.college ?? null;

      // Validation above guarantees this matches a configured Lead Stage.
      const leadStage = d.leadStage.trim();

      const existing = await prisma.lead.findFirst({
        where: { email, college: college ? { equals: college, mode: 'insensitive' } : null },
        select: { id: true, leadStage: true },
      });
      if (existing) {
        // A repeat of the same lead at a NEW stage is progress, not a duplicate:
        // record the stage and move the lead forward instead of rejecting it.
        // Only an unchanged stage is a true duplicate.
        if (leadStage && existing.leadStage !== leadStage) {
          await prisma.$transaction([
            prisma.lead.update({ where: { id: existing.id }, data: { leadStage } }),
            prisma.leadStageEntry.create({ data: { leadId: existing.id, stage: leadStage, source: 'API' } }),
          ]);
          await logActivity({
            userId: apiKey.createdById,
            action: 'LEAD_CREATED_VIA_API',
            targetId: existing.id,
            targetType: 'Lead',
            description: `Lead stage updated to "${leadStage}" via API key "${apiKey.name}"`,
            metadata: { leadId: existing.id, from: existing.leadStage, to: leadStage },
          });
          return NextResponse.json(
            { success: true, message: `Lead stage updated to "${leadStage}"`, Lead_ID: existing.id },
            { status: 200 },
          );
        }
        return NextResponse.json(
          { success: false, message: 'Duplicate lead — a lead with this email and college already exists', Lead_ID: existing.id },
          { status: 409 },
        );
      }

      const now = new Date();
      const lead = await prisma.lead.create({
        data: {
          // Not @updatedAt any more (see schema.prisma).
          updatedAt: new Date(),
          name: d.name, email, phone: d.phone,
          city: resolved.city, state: resolved.state, course: resolved.course, college,
          kappCollegeId: d.kappCollegeId, campaign: d.leadCode,
          leadType: d.leadType, leadOrigin: d.leadOrigin, leadConfirmation: d.leadConfirmation,
          leadStage, leadVerification: d.leadVerification,
          dataCallingType: d.dataCallingType, dealType: d.dealType,
          primaryApplicationConfirm: 'No', primaryAdmissionConfirm: 'No',
          uploadedAt: new Date(`${d.createdAt}T00:00:00.000Z`),
          status: 'APPROVED', approvedById: apiKey.createdById, approvedAt: now,
          uploadedById: apiKey.createdById, apiKeyId: apiKey.id,
          // Seed the history with the stage it arrived on, so the timeline is
          // complete from the first record rather than starting at the second.
          ...(leadStage ? { stageHistory: { create: { stage: leadStage, source: 'API' } } } : {}),
        },
        select: { id: true },
      });

      await logActivity({
        userId: apiKey.createdById,
        action: 'LEAD_CREATED_VIA_API',
        targetId: lead.id,
        targetType: 'Lead',
        description: `Lead ${lead.id} created via API key "${apiKey.name}" — auto-approved, sent to Unassigned Leads`,
        metadata: { apiKeyId: apiKey.id, apiKeyName: apiKey.name },
      });

      return NextResponse.json({ success: true, message: 'Lead Processed Successfully', Lead_ID: lead.id }, { status: 201 });
    }

    // ═══════════════════════════════════════════════════════════════════
    // Array request — bulk ingestion
    // ═══════════════════════════════════════════════════════════════════
    if (body.length === 0) return fail(400, 'Array must contain at least 1 lead');
    if (body.length > MAX_BULK) return fail(400, `A single request can contain at most ${MAX_BULK} leads — split into multiple calls`);

    type Pending = { index: number; d: LeadPayload; college: string | null };
    const results: ({ index: number; success: boolean; message: string; Lead_ID?: string; errors?: Record<string, string> })[] =
      new Array(body.length);
    const pending: Pending[] = [];

    // Phase 1 — shape + cross-reference validation for every item (no DB calls)
    for (let index = 0; index < body.length; index++) {
      const parsed = payloadSchema.safeParse(body[index]);
      if (!parsed.success) {
        results[index] = { index, success: false, message: 'Validation failed', errors: fieldErrorsFromZod(parsed.error) };
        continue;
      }
      const d = parsed.data;
      const { errors, resolved } = resolveAndValidate(d, maps);
      if (Object.keys(errors).length > 0) {
        results[index] = { index, success: false, message: 'Validation failed', errors };
        continue;
      }
      pending.push({ index, d, college: resolved.college ?? null });
    }

    // Phase 2 — duplicate check, batched into ONE query against leads already
    // in the CRM, plus dedup against earlier items in this same array.
    if (pending.length > 0) {
      const existing = await prisma.lead.findMany({
        where: { OR: pending.map((p) => ({ email: p.d.email.toLowerCase(), college: p.college ? { equals: p.college, mode: 'insensitive' as const } : null })) },
        select: { id: true, email: true, college: true, leadStage: true },
      });
      const existingByKey = new Map<string, { id: string; leadStage: string | null }>();
      for (const e of existing) existingByKey.set(dedupeKey(e.email, e.college), { id: e.id, leadStage: e.leadStage });

      // Every stage here already passed validation against the configured list.
      const canonicalStage = (raw: string | null | undefined) => (raw ? raw.trim() : null);

      // key -> the item that will create the lead, plus the stage the batch has
      // left it on so far. The stage is tracked because a later item for the
      // same lead at a DIFFERENT stage is a stage advance, not a duplicate —
      // exactly as for a lead that already existed in the CRM.
      const seenInBatch = new Map<string, { index: number; stage: string | null }>();
      const toCreate: Pending[] = [];
      const duplicateOfIndex = new Map<number, number>(); // index -> index of the batch item creating it

      // Same-lead-new-stage advances the existing lead; see the single path.
      const stageUpdates: { index: number; leadId: string; from: string | null; stage: string }[] = [];
      // Same, but for a lead created earlier in THIS request, whose id only
      // exists after Phase 3.
      const intraBatchStageUpdates: { index: number; sourceIndex: number; stage: string }[] = [];

      for (const p of pending) {
        const key = dedupeKey(p.d.email, p.college);
        const hit = existingByKey.get(key);
        if (hit) {
          const stage = canonicalStage(p.d.leadStage);
          if (stage && hit.leadStage !== stage) {
            stageUpdates.push({ index: p.index, leadId: hit.id, from: hit.leadStage, stage });
            // Keep the map current so a second item for the same lead later in
            // this request compares against the stage we are about to write,
            // instead of re-applying the same update.
            existingByKey.set(key, { id: hit.id, leadStage: stage });
          } else {
            results[p.index] = { index: p.index, success: false, message: 'Duplicate lead — a lead with this email and college already exists', Lead_ID: hit.id };
          }
          continue;
        }
        const seen = seenInBatch.get(key);
        if (seen !== undefined) {
          const stage = canonicalStage(p.d.leadStage);
          if (stage && seen.stage !== stage) {
            // The lead does not exist yet — it is created by item `seen.index`
            // in Phase 3 below, so its id isn't known until then. Queue the
            // advance and resolve the id afterwards.
            intraBatchStageUpdates.push({ index: p.index, sourceIndex: seen.index, stage });
            seenInBatch.set(key, { index: seen.index, stage });
          } else {
            duplicateOfIndex.set(p.index, seen.index);
          }
          continue;
        }
        seenInBatch.set(key, { index: p.index, stage: canonicalStage(p.d.leadStage) });
        toCreate.push(p);
      }

      // Apply stage advances for leads that already existed.
      //
      // Grouped by lead and applied IN REQUEST ORDER within each group. One
      // request can legitimately carry the same lead twice at different stages
      // (L5 then L6); running those concurrently let them commit out of order,
      // so the history read backwards and Lead.leadStage ended up on whichever
      // transaction happened to finish last. Different leads still go in
      // parallel — only same-lead updates have to be sequenced.
      if (stageUpdates.length > 0) {
        const byLead = new Map<string, typeof stageUpdates>();
        for (const u of stageUpdates) {
          const list = byLead.get(u.leadId);
          if (list) list.push(u);
          else byLead.set(u.leadId, [u]);
        }

        await Promise.all(Array.from(byLead.values()).map(async (updates) => {
          for (const u of updates) {
            try {
              await prisma.$transaction([
                prisma.lead.update({ where: { id: u.leadId }, data: { leadStage: u.stage } }),
                prisma.leadStageEntry.create({ data: { leadId: u.leadId, stage: u.stage, source: 'API' } }),
              ]);
              results[u.index] = { index: u.index, success: true, message: `Lead stage updated to "${u.stage}"`, Lead_ID: u.leadId };
            } catch (err) {
              console.error('[v1/leads POST bulk] failed to update stage for item', u.index, err);
              results[u.index] = { index: u.index, success: false, message: 'Internal server error updating this lead stage', Lead_ID: u.leadId };
            }
          }
        }));
      }

      // Phase 3 — create everything that's left, in parallel
      const now = new Date();
      const createdIdByIndex = new Map<number, string>();
      await Promise.all(toCreate.map(async (p) => {
        try {
          const { d, college, index } = p;
          const { resolved } = resolveAndValidate(d, maps); // cheap, re-derive canonical city/state/course
          const lead = await prisma.lead.create({
            data: {
              // Not @updatedAt any more (see schema.prisma).
              updatedAt: new Date(),
              name: d.name, email: d.email.toLowerCase(), phone: d.phone,
              city: resolved.city, state: resolved.state, course: resolved.course, college,
              kappCollegeId: d.kappCollegeId, campaign: d.leadCode,
              leadType: d.leadType, leadOrigin: d.leadOrigin, leadConfirmation: d.leadConfirmation,
              leadStage: canonicalStage(d.leadStage), leadVerification: d.leadVerification,
              dataCallingType: d.dataCallingType, dealType: d.dealType,
              primaryApplicationConfirm: 'No', primaryAdmissionConfirm: 'No',
              uploadedAt: new Date(`${d.createdAt}T00:00:00.000Z`),
              status: 'APPROVED', approvedById: apiKey.createdById, approvedAt: now,
              uploadedById: apiKey.createdById, apiKeyId: apiKey.id,
              ...(canonicalStage(d.leadStage)
                ? { stageHistory: { create: { stage: canonicalStage(d.leadStage)!, source: 'API' } } }
                : {}),
            },
            select: { id: true },
          });
          createdIdByIndex.set(index, lead.id);
          results[index] = { index, success: true, message: 'Lead Processed Successfully', Lead_ID: lead.id };
        } catch (err) {
          console.error('[v1/leads POST bulk] failed to create item', p.index, err);
          results[p.index] = { index: p.index, success: false, message: 'Internal server error creating this lead' };
        }
      }));

      // Stage advances for leads created moments ago in this same request.
      // Sequential per lead so the recorded order matches the request order.
      if (intraBatchStageUpdates.length > 0) {
        const byLead = new Map<string, typeof intraBatchStageUpdates>();
        for (const u of intraBatchStageUpdates) {
          const leadId = createdIdByIndex.get(u.sourceIndex);
          if (!leadId) {
            // The creating item failed, so there is nothing to advance.
            results[u.index] = { index: u.index, success: false, message: 'Duplicate lead — same email and college as another lead earlier in this request, which failed to create' };
            continue;
          }
          const list = byLead.get(leadId);
          if (list) list.push(u);
          else byLead.set(leadId, [u]);
        }
        await Promise.all(Array.from(byLead.entries()).map(async ([leadId, updates]) => {
          for (const u of updates) {
            try {
              await prisma.$transaction([
                prisma.lead.update({ where: { id: leadId }, data: { leadStage: u.stage } }),
                prisma.leadStageEntry.create({ data: { leadId, stage: u.stage, source: 'API' } }),
              ]);
              results[u.index] = { index: u.index, success: true, message: `Lead stage updated to "${u.stage}"`, Lead_ID: leadId };
            } catch (err) {
              console.error('[v1/leads POST bulk] failed to update in-batch stage for item', u.index, err);
              results[u.index] = { index: u.index, success: false, message: 'Internal server error updating this lead stage', Lead_ID: leadId };
            }
          }
        }));
      }

      // Backfill intra-batch duplicates with the Lead_ID that was actually created for them
      duplicateOfIndex.forEach((sourceIndex, dupIndex) => {
        const sourceId = createdIdByIndex.get(sourceIndex);
        results[dupIndex] = sourceId
          ? { index: dupIndex, success: false, message: 'Duplicate lead — same email and college as another lead earlier in this request', Lead_ID: sourceId }
          : { index: dupIndex, success: false, message: 'Duplicate lead — same email and college as another lead earlier in this request, which failed to create' };
      });
    }

    // A stage advance succeeds but creates nothing, so it is counted separately
    // rather than inflating `created` — the caller needs to tell "6 new leads"
    // apart from "6 existing leads moved on a stage".
    const isStageUpdate = (m: string) => m.startsWith('Lead stage updated');
    const summary = {
      total: results.length,
      created: results.filter((r) => r.success && !isStageUpdate(r.message)).length,
      stageUpdated: results.filter((r) => r.success && isStageUpdate(r.message)).length,
      duplicate: results.filter((r) => !r.success && r.message.startsWith('Duplicate')).length,
      failed: results.filter((r) => !r.success && !r.message.startsWith('Duplicate')).length,
    };

    if (summary.created > 0) {
      await logActivity({
        userId: apiKey.createdById,
        action: 'LEAD_CREATED_VIA_API',
        targetId: 'bulk',
        targetType: 'Lead',
        description: `${summary.created} lead(s) created via bulk API key "${apiKey.name}" (${summary.total} sent, ${summary.duplicate} duplicate, ${summary.failed} failed) — auto-approved, sent to Unassigned Leads`,
        metadata: { apiKeyId: apiKey.id, apiKeyName: apiKey.name, ...summary },
      });
    }

    return NextResponse.json(
      {
        success: summary.created > 0,
        message: `Processed ${summary.total} lead${summary.total === 1 ? '' : 's'} — ${summary.created} created, ${summary.stageUpdated} stage updated, ${summary.duplicate} duplicate, ${summary.failed} failed`,
        summary,
        results,
      },
      { status: summary.created > 0 ? 201 : 400 },
    );
  } catch (error) {
    console.error('[v1/leads POST]', error);
    return fail(500, 'Internal server error');
  }
}
