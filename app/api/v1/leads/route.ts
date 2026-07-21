import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DropdownType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { verifyApiKey } from '@/lib/api-key';
import { fetchLmsCityNames, fetchLmsStateNames, fetchLmsCourseNames, toCanonicalMap } from '@/lib/lms-api';
import { buildDropdownValidationSets, isAllowedDropdownValue } from '@/lib/dropdown-validation';

// ═════════════════════════════════════════════════════════════════════════
// POST /api/v1/leads — External Lead Ingestion API
// ═════════════════════════════════════════════════════════════════════════
//
// Lets an external system (partner LMS, referral site, landing-page backend,
// etc.) push a lead directly into this CRM.
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
// REQUEST BODY (application/json)
//   Every field below is REQUIRED. A request missing any of them, or with a
//   value that fails its check, is rejected with 400 and never creates a lead.
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
// RESPONSES
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

function fail(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...extra }, { status });
}

export async function POST(req: NextRequest) {
  try {
    // ── Authentication ──────────────────────────────────────────────────
    const apiKey = await verifyApiKey(req.headers.get('authorization'));
    if (!apiKey) return fail(401, 'Missing or invalid API key');

    // ── Shape validation ────────────────────────────────────────────────
    const body = await req.json().catch(() => null);
    if (body === null) return fail(400, 'Request body must be valid JSON');

    const parsed = payloadSchema.safeParse(body);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!errors[key]) errors[key] = issue.message;
      }
      return fail(400, 'Validation failed', { errors });
    }
    const d = parsed.data;

    // ── Cross-reference validation (city/state/course/college/dropdowns) ──
    const errors: Record<string, string> = {};

    const [cityNames, stateNames, courseNames, dropdownData] = await Promise.all([
      fetchLmsCityNames().catch(() => null),
      fetchLmsStateNames().catch(() => null),
      fetchLmsCourseNames().catch(() => null),
      buildDropdownValidationSets(),
    ]);

    if (cityNames === null || stateNames === null || courseNames === null) {
      return fail(502, 'Could not verify city/state/course against the location provider — please retry');
    }

    let resolvedCity: string | undefined;
    const canonicalCity = toCanonicalMap(cityNames).get(d.city.toLowerCase());
    if (!canonicalCity) errors.city = `"${d.city}" does not match any known city`;
    else resolvedCity = canonicalCity;

    let resolvedState: string | undefined;
    const canonicalState = toCanonicalMap(stateNames).get(d.state.toLowerCase());
    if (!canonicalState) errors.state = `"${d.state}" does not match any known state`;
    else resolvedState = canonicalState;

    let resolvedCourse: string | undefined;
    const canonicalCourse = toCanonicalMap(courseNames).get(d.course.toLowerCase());
    if (!canonicalCourse) errors.course = `"${d.course}" does not match any known course`;
    else resolvedCourse = canonicalCourse;

    let resolvedCollege: string | undefined;
    const canonicalCollege = dropdownData.collegeIdMap.get(d.kappCollegeId.toLowerCase());
    if (!canonicalCollege) errors.kappCollegeId = `"${d.kappCollegeId}" is not a valid KAPP College ID`;
    else resolvedCollege = canonicalCollege;

    const checkDropdown = (type: DropdownType, value: string, field: string, label: string) => {
      if (!isAllowedDropdownValue(dropdownData, type, value)) {
        errors[field] = `"${value}" is not a configured ${label} value`;
      }
    };
    checkDropdown(DropdownType.LEAD_TYPE, d.leadType, 'leadType', 'Lead Type');
    checkDropdown(DropdownType.LEAD_ORIGIN, d.leadOrigin, 'leadOrigin', 'Lead Origin');
    checkDropdown(DropdownType.LEAD_CONFIRMATION, d.leadConfirmation, 'leadConfirmation', 'Lead Confirmation');
    checkDropdown(DropdownType.LEAD_STAGE, d.leadStage, 'leadStage', 'Lead Stage');
    checkDropdown(DropdownType.LEAD_VERIFICATION, d.leadVerification, 'leadVerification', 'Lead Verification');
    checkDropdown(DropdownType.DATA_CALLING_TYPE, d.dataCallingType, 'dataCallingType', 'Data Calling Type');
    checkDropdown(DropdownType.DEAL_TYPE, d.dealType, 'dealType', 'Deal Type');

    if (Object.keys(errors).length > 0) {
      return fail(400, 'Validation failed', { errors });
    }

    // ── Duplicate check (same rule as CSV upload / Single Add Lead: email + college) ──
    const email = d.email.toLowerCase();
    const college = resolvedCollege ?? null;

    const existing = await prisma.lead.findFirst({
      where: { email, college: college ? { equals: college, mode: 'insensitive' } : null },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        {
          success: false,
          message: 'Duplicate lead — a lead with this email and college already exists',
          Lead_ID: existing.id,
        },
        { status: 409 },
      );
    }

    // ── Create — APPROVED + unassigned, skipping Lead Approvals entirely ──
    const now = new Date();
    const lead = await prisma.lead.create({
      data: {
        name: d.name,
        email,
        phone: d.phone,
        city: resolvedCity,
        state: resolvedState,
        course: resolvedCourse,
        college,
        kappCollegeId: d.kappCollegeId,
        campaign: d.leadCode,
        leadType: d.leadType,
        leadOrigin: d.leadOrigin,
        leadConfirmation: d.leadConfirmation,
        leadStage: d.leadStage,
        leadVerification: d.leadVerification,
        dataCallingType: d.dataCallingType,
        dealType: d.dealType,
        primaryApplicationConfirm: 'No',
        primaryAdmissionConfirm: 'No',
        uploadedAt: new Date(`${d.createdAt}T00:00:00.000Z`),
        status: 'APPROVED',
        approvedById: apiKey.createdById,
        approvedAt: now,
        uploadedById: apiKey.createdById,
        apiKeyId: apiKey.id,
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

    return NextResponse.json(
      { success: true, message: 'Lead Processed Successfully', Lead_ID: lead.id },
      { status: 201 },
    );
  } catch (error) {
    console.error('[v1/leads POST]', error);
    return fail(500, 'Internal server error');
  }
}
