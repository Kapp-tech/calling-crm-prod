import { DropdownType } from '@prisma/client';
import { prisma } from './prisma';

export interface DropdownValidationSets {
  /** Allowed values per dropdown type (exact, case-sensitive) — e.g. sets[LEAD_TYPE] = Set{"Hot","Cold",...}. */
  sets: Partial<Record<DropdownType, Set<string>>>;
  /** kappCollegeId (lowercased) → canonical college name, built from the COLLEGE dropdown type. */
  collegeIdMap: Map<string, string>;
  /**
   * kappCollegeId (lowercased) → the Zone and Deal Type configured for that
   * college in Manage Colleges. Leads inherit these on ingest, so both CSV
   * upload and the API read them from here rather than from the payload.
   */
  collegeAttributeMap: Map<string, { zone: string | null; dealType: string | null }>;
  /**
   * lead code (lowercased) → the Data Calling Type mapped to it in LeadCode
   * List. Lowercased because the same code arrives in several casings.
   *
   * Lives on the prebuilt maps rather than being queried per lead: the bulk
   * ingest path creates leads inside a Promise.all, so a lookup per lead would
   * be one extra query per lead in the batch.
   */
  leadCodeCallingTypeMap: Map<string, string>;
}

/**
 * Loads every active DropdownOption once and buckets it for fast, in-memory
 * validation. Shared by CSV upload and the external lead-ingestion API so
 * both enforce identical rules against Manage Dropdowns.
 */
export async function buildDropdownValidationSets(): Promise<DropdownValidationSets> {
  const allOptions = await prisma.dropdownOption.findMany({
    where: { isActive: true },
    select: { type: true, value: true, kappCollegeId: true, collegeZone: true, collegeDealType: true, leadCodeCallingType: true },
  });

  const sets: Partial<Record<DropdownType, Set<string>>> = {};
  const collegeIdMap = new Map<string, string>();
  const collegeAttributeMap = new Map<string, { zone: string | null; dealType: string | null }>();
  const leadCodeCallingTypeMap = new Map<string, string>();

  for (const opt of allOptions) {
    if (opt.type === DropdownType.COLLEGE) {
      // College ID matching is case-insensitive (it's a code, not a display value)
      if (opt.kappCollegeId) {
        const key = opt.kappCollegeId.trim().toLowerCase();
        collegeIdMap.set(key, opt.value.trim());
        collegeAttributeMap.set(key, {
          zone: opt.collegeZone?.trim() || null,
          dealType: opt.collegeDealType?.trim() || null,
        });
      }
    } else if (opt.type === DropdownType.LEAD_CODE) {
      // Not added to `sets`: a lead code is a mapping key, not a value anything
      // is validated against — a CSV may carry any code at all.
      if (opt.leadCodeCallingType) {
        leadCodeCallingTypeMap.set(opt.value.trim().toLowerCase(), opt.leadCodeCallingType);
      }
    } else {
      if (!sets[opt.type]) sets[opt.type] = new Set();
      sets[opt.type]!.add(opt.value.trim()); // stored exactly as configured — matching is case-sensitive
    }
  }

  return { sets, collegeIdMap, collegeAttributeMap, leadCodeCallingTypeMap };
}

/**
 * True if `value` is allowed for `type`: an empty value always passes
 * (validate only what's provided), and a type with zero configured options
 * is treated as "no rule defined yet" rather than "nothing is allowed".
 */
export function isAllowedDropdownValue(
  v: DropdownValidationSets,
  type: DropdownType,
  value: string | null | undefined,
): boolean {
  const set = v.sets[type];
  if (!set || set.size === 0) return true;
  if (!value?.trim()) return true;
  return set.has(value.trim());
}
