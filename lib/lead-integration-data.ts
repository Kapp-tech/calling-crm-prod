import type { Lead, LeadProfile } from '@prisma/client';
import { resolveCityId, resolveStateId } from '@/lib/lms-location-lookup';
import { resolveCourseGroupId } from '@/lib/lms-course-lookup';

// Server-only: resolves cityId/stateId/courseId against the LMS's live
// unified-data API, so this must never be imported from a 'use client'
// component (that chain eventually reaches lib/lms-api.ts's hardcoded API
// key). The static, client-safe field catalog/sample data live in
// lib/lead-integration-fields.ts.

export type LeadForTemplate = Lead & {
  profile?: LeadProfile | null;
  referredBy?: { name: string } | null;
  assignedTo?: {
    id: string;
    name: string;
    email: string;
    employeeCode: string | null;
    dialshreeId: string | null;
  } | null;
};

/**
 * Why a push is happening. The same integration serves both, and the LMS wants
 * a different lead_code for each, so the template has to be able to tell them
 * apart — see `pushLeadCode`.
 */
export type PushSource = 'REFERRAL' | 'COLLEGE_PREFERENCES';

/**
 * The lead_code a REFERRAL pushes.
 *
 * It lived as a literal in the body template, which was fine while every push
 * was a referral. Now that college preferences push through the same
 * integration and must send the lead's real code, one of the two has to be
 * decided somewhere the template can't — the template engine has no
 * conditionals, deliberately, since it renders admin-authored text and must
 * never become a place to run logic.
 */
export const REFERRAL_LEAD_CODE = 'CRM100';

/** Flattens a fetched lead (+ relations) into the flat key/value shape FIELD_CATALOG describes. */
export async function buildLeadTemplateData(
  lead: LeadForTemplate,
  source: PushSource = 'REFERRAL',
): Promise<Record<string, unknown>> {
  const profile = lead.profile;
  const [cityId, stateId, courseId] = await Promise.all([
    resolveCityId(lead.city),
    resolveStateId(lead.state),
    resolveCourseGroupId(lead.course),
  ]);

  return {
    id: lead.id,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    city: lead.city,
    state: lead.state,
    cityId,
    stateId,
    course: lead.course,
    courseId,
    college: lead.college,
    kappCollegeId: lead.kappCollegeId,
    /**
     * Every college to send for this lead, as an array — the shortlist if the
     * student has one, otherwise the single college the lead itself carries.
     *
     * The fallback is the point. A referral has a college and usually no
     * shortlist; pushing the shortlist alone would send `[]` for those and lose
     * the college that made the referral worth sending. Pairing them in one
     * field means `"kapp_id": {{jsonArray(kappCollegeIds)}}` is correct for
     * both paths, so there is no second template branch to get wrong.
     *
     * Preferences win when present: a student who has named six colleges has
     * said something more specific than the one the lead arrived under.
     */
    kappCollegeIds: (() => {
      const prefs = profile?.preferredCollegeIds;
      if (Array.isArray(prefs) && prefs.length > 0) return prefs;
      return lead.kappCollegeId ? [lead.kappCollegeId] : [];
    })(),
    campaign: lead.campaign,
    pushSource: source,
    /**
     * The lead_code to send, already decided.
     *
     * A referral is a new name the CRM introduced, so it carries the CRM's own
     * code. A college-preferences push is an existing lead being updated, and
     * it has to keep the code it arrived with or the LMS cannot reconcile it
     * with the lead it already holds.
     *
     * Falls back for a preferences push on a lead with no code of its own —
     * sending an empty lead_code would be worse than sending the CRM's.
     */
    pushLeadCode:
      source === 'COLLEGE_PREFERENCES'
        ? (lead.campaign?.trim() || REFERRAL_LEAD_CODE)
        : REFERRAL_LEAD_CODE,
    leadType: lead.leadType,
    leadOrigin: lead.leadOrigin,
    leadZone: lead.leadZone,
    category: lead.category,
    gender: lead.gender,
    classYear: lead.classYear,
    parentName: lead.parentName,
    parentMobile: lead.parentMobile,
    altEmail1: lead.altEmail1,
    altEmail2: lead.altEmail2,
    altPhone1: lead.altPhone1,
    altPhone2: lead.altPhone2,
    correctCity: lead.correctCity,
    correctState: lead.correctState,
    createdAt: lead.createdAt?.toISOString(),
    referredBy_name: lead.referredBy?.name ?? null,

    // Every agent identifier the receiving system might key on. Null on an
    // unassigned lead — the template renderer turns that into an empty string.
    assignedTo_name: lead.assignedTo?.name ?? null,
    assignedTo_employeeCode: lead.assignedTo?.employeeCode ?? null,
    assignedTo_id: lead.assignedTo?.id ?? null,
    assignedTo_email: lead.assignedTo?.email ?? null,
    assignedTo_dialshreeId: lead.assignedTo?.dialshreeId ?? null,

    profile_budget: profile?.budget ?? null,
    profile_courseType: profile?.courseType ?? null,
    profile_collegeType: profile?.collegeType ?? null,
    profile_specialisation: profile?.specialisation ?? null,
    profile_scholarshipAwareness: profile?.scholarshipAwareness ?? null,
    profile_loanRequirement: profile?.loanRequirement ?? null,
    profile_loanAmount: profile?.loanAmount ?? null,
    profile_paymentModePreference: profile?.paymentModePreference ?? null,
    profile_stayPreference: profile?.stayPreference ?? null,
    profile_class10Percentage: profile?.class10Percentage ?? null,
    profile_class12Percentage: profile?.class12Percentage ?? null,
    profile_board: profile?.board ?? null,
    profile_mediumOfInstruction: profile?.mediumOfInstruction ?? null,
    profile_preferredCollegeIds: profile?.preferredCollegeIds ?? null,
    profile_preferredCityNames: profile?.preferredCityNames ?? null,
    profile_preferredStateNames: profile?.preferredStateNames ?? null,
    profile_entranceExam: profile?.entranceExam ?? null,
    profile_keyAmenities: profile?.keyAmenities ?? null,

    today: new Date().toISOString().slice(0, 10),
    now: new Date().toISOString(),
  };
}
