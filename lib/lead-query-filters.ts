import { z } from 'zod';
import type { PrismaClient, Role } from '@prisma/client';
import { LeadStatus } from '@prisma/client';
import { istStartOfDay, istEndOfDay } from '@/lib/ist-time';
import { parseCsvFilterValues } from '@/lib/csv-filter-value';
import { UNSET_SESSION_YEAR } from '@/lib/college-attributes';

/**
 * The "other" leads-list filters — everything except feedback selection
 * (feedbackTab / feedbackOptionIds / feedbackCategoryIds) and pagination.
 * Shared by every endpoint that needs to filter the leads list the same way
 * the main All Leads page does (currently /api/leads and
 * /api/leads/feedback-category-counts), so their filter semantics can never
 * drift out of sync with each other — that drift is exactly what caused the
 * category badge counts to disagree with the actual filtered results.
 */
export const nonFeedbackQuerySchema = z.object({
  status:       z.nativeEnum(LeadStatus).optional(),
  assignedToId: z.string().optional(),   // comma-separated agent IDs
  uploadedById: z.string().optional(),
  batchId:      z.string().optional(),   // CSV upload batch — the most precise way to target a mistaken upload
  search:       z.string().optional(),
  zone:         z.string().optional(),   // comma-separated
  city:         z.string().optional(),   // comma-separated
  state:        z.string().optional(),   // comma-separated
  course:       z.string().optional(),   // comma-separated
  college:      z.string().optional(),   // comma-separated
  campaign:     z.string().optional(),   // comma-separated
  leadType:     z.string().optional(),   // comma-separated
  leadOrigin:   z.string().optional(),   // comma-separated
  tlId:             z.string().optional(),   // comma-separated TL IDs
  // 'all' imposes no constraint, so it is normalised away rather than kept.
  // hasAnyFilter() treats any present value as "a filter is set", and the
  // bulk-delete tool refuses to run unscoped — leaving 'all' in place would let
  // `assignmentStatus=all` satisfy that guard while matching every lead.
  assignmentStatus: z
    .enum(['all', 'unassigned', 'assigned'])
    .optional()
    .transform((v) => (v === 'all' ? undefined : v)),
  dateFrom:    z.string().optional(),
  dateTo:      z.string().optional(),
  updatedFrom: z.string().optional(),
  updatedTo:   z.string().optional(),
  primaryAppConfirm:       z.string().optional(),
  primaryAdmConfirm:       z.string().optional(),
  leadConfirmation:        z.string().optional(),
  leadStage:               z.string().optional(),
  leadVerification:        z.string().optional(),
  dataCallingType:         z.string().optional(),
  dealType:                z.string().optional(),
  // Session/Year is the college's, not the lead's — see sessionYearClause.
  sessionYear:             z.string().optional(),
});

export type NonFeedbackQuery = z.infer<typeof nonFeedbackQuerySchema>;

/**
 * True if at least one real filter field was supplied. Used to block
 * destructive bulk operations (e.g. delete-by-filter) from running
 * unscoped — an empty query object must never be treated as "match every
 * lead" for anything that deletes data.
 */
export function hasAnyFilter(q: NonFeedbackQuery): boolean {
  return Object.values(q).some((v) => v !== undefined && v !== '');
}

// A value here can itself contain a literal comma (college names are very
// often "Name, City") — see lib/csv-filter-value.ts for why a plain
// split(',') silently shredded those into fragments that matched nothing.
export const splitCsv = parseCsvFilterValues;

/**
 * Session/Year as a Prisma clause on `Lead.college`.
 *
 * The value is not on the lead: it is configured on the college and read live,
 * which is the whole point of it. So filtering by it means "leads whose college
 * carries one of these years", which needs the college list resolved first.
 *
 * `NA` is a real, selectable value because that is what the column shows for a
 * college with no year set — and it has to cover three cases at once: a college
 * with the field empty, a lead with no college at all, and a lead whose college
 * is not in the curated list. `NOT IN` alone would silently drop the null ones,
 * because in SQL `college NOT IN (...)` is unknown rather than true when
 * `college` is NULL.
 *
 * A year no college carries returns `in: []` — matching nothing. It must not
 * fall through to "no filter", which would show every lead and read as the
 * filter being ignored.
 */
export async function sessionYearClause(
  db: { dropdownOption: { findMany: Function } },
  years: string[],
): Promise<Record<string, unknown>> {
  // Active rows only, matching what the All Leads column actually shows — an
  // inactive 2026 row alongside an active 2027 one must not pull its leads into
  // a "2026" filter when the table reads 2027 for them.
  const rows = (await db.dropdownOption.findMany({
    where: { type: 'COLLEGE', isActive: true },
    select: { value: true, collegeSessionYear: true },
  })) as { value: string; collegeSessionYear: string | null }[];

  const wantUnset = years.some((y) => y.trim().toUpperCase() === UNSET_SESSION_YEAR.toUpperCase());
  const wanted = new Set(
    years.map((y) => y.trim().toLowerCase()).filter((y) => y && y !== UNSET_SESSION_YEAR.toLowerCase()),
  );

  const matched: string[] = [];
  const withAnyYear: string[] = [];
  for (const r of rows) {
    const year = r.collegeSessionYear?.trim();
    if (!year) continue;
    withAnyYear.push(r.value);
    if (wanted.has(year.toLowerCase())) matched.push(r.value);
  }

  const clauses: Record<string, unknown>[] = [];
  if (matched.length > 0) clauses.push({ college: { in: matched, mode: 'insensitive' } });
  if (wantUnset) {
    const unset: Record<string, unknown>[] = [{ college: null }, { college: '' }];
    if (withAnyYear.length > 0) {
      unset.push({ college: { notIn: withAnyYear, mode: 'insensitive' } });
    } else {
      // No college anywhere has a year, so every lead reads NA.
      unset.push({ college: { not: null } });
    }
    clauses.push({ OR: unset });
  }

  if (clauses.length === 0) return { college: { in: [] } };
  if (clauses.length === 1) return clauses[0];
  return { OR: clauses };
}

/**
 * Async because of Session/Year alone, and deliberately inside this shared
 * builder rather than bolted onto the two list endpoints: `hasAnyFilter` counts
 * `sessionYear` as "a filter is set", and bulk-delete-by-filter relies on that
 * guard. A filter that registered as scoping but was not actually applied there
 * would let a delete run far wider than the screen showed.
 */
export async function buildNonFeedbackFilters(
  db: { dropdownOption: { findMany: Function } },
  q: NonFeedbackQuery,
  sessionUser: { id: string; role: Role },
): Promise<Record<string, unknown>[]> {
  const cities      = splitCsv(q.city);
  const states      = splitCsv(q.state);
  const courses     = splitCsv(q.course);
  const colleges    = splitCsv(q.college);
  const campaigns   = splitCsv(q.campaign);
  const leadTypes   = splitCsv(q.leadType);
  const leadOrigins = splitCsv(q.leadOrigin);
  const zones       = splitCsv(q.zone);
  const tlIds       = splitCsv(q.tlId);
  const agentIds    = splitCsv(q.assignedToId);

  const filters: Record<string, unknown>[] = [];

  if (q.status) filters.push({ status: q.status });
  if (agentIds.length > 0 && sessionUser.role !== 'COUNSELLING_AGENT') {
    filters.push({ assignedToId: { in: agentIds } });
  }
  if (q.assignmentStatus === 'unassigned') filters.push({ assignedToId: null });
  if (q.assignmentStatus === 'assigned')   filters.push({ assignedToId: { not: null } });
  if (q.uploadedById) filters.push({ uploadedById: q.uploadedById });
  if (q.batchId) filters.push({ batchId: q.batchId });
  if (q.search) {
    filters.push({
      OR: [
        { id:    { contains: q.search, mode: 'insensitive' } },
        { name:  { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
        { phone: { contains: q.search, mode: 'insensitive' } },
        { city:  { contains: q.search, mode: 'insensitive' } },
      ],
    });
  }
  if (cities.length > 0)      filters.push({ city:      { in: cities,      mode: 'insensitive' } });
  if (states.length > 0)      filters.push({ state:     { in: states,      mode: 'insensitive' } });
  if (courses.length > 0)     filters.push({ course:    { in: courses,     mode: 'insensitive' } });
  if (colleges.length > 0)    filters.push({ college:   { in: colleges,    mode: 'insensitive' } });
  if (campaigns.length > 0)   filters.push({ campaign:  { in: campaigns,   mode: 'insensitive' } });
  if (leadTypes.length > 0)   filters.push({ leadType:  { in: leadTypes,   mode: 'insensitive' } });
  if (leadOrigins.length > 0) filters.push({ leadOrigin:{ in: leadOrigins, mode: 'insensitive' } });
  if (zones.length > 0)       filters.push({ leadZone:  { in: zones,       mode: 'insensitive' } });
  if (tlIds.length > 0 && sessionUser.role !== 'COUNSELLING_AGENT') {
    filters.push({ team: { teamLeadId: { in: tlIds } } });
  }
  // Date filters denote IST calendar days — see lib/ist-time.ts for why the
  // plain `new Date(day)` / `setHours(23,59,59,999)` pair got these wrong.
  if (q.dateFrom) filters.push({ createdAt: { gte: istStartOfDay(q.dateFrom) } });
  if (q.dateTo) filters.push({ createdAt: { lte: istEndOfDay(q.dateTo) } });
  if (q.updatedFrom) filters.push({ updatedAt: { gte: istStartOfDay(q.updatedFrom) } });
  if (q.updatedTo) filters.push({ updatedAt: { lte: istEndOfDay(q.updatedTo) } });
  if (q.primaryAppConfirm) {
    const vals = splitCsv(q.primaryAppConfirm);
    if (vals.length > 0) filters.push({ primaryApplicationConfirm: { in: vals } });
  }
  if (q.primaryAdmConfirm) {
    const vals = splitCsv(q.primaryAdmConfirm);
    if (vals.length > 0) filters.push({ primaryAdmissionConfirm: { in: vals } });
  }
  if (q.leadConfirmation) {
    const vals = splitCsv(q.leadConfirmation);
    if (vals.length > 0) filters.push({ leadConfirmation: { in: vals } });
  }
  if (q.leadStage) {
    const vals = splitCsv(q.leadStage);
    if (vals.length > 0) filters.push({ leadStage: { in: vals } });
  }
  if (q.leadVerification) {
    const vals = splitCsv(q.leadVerification);
    if (vals.length > 0) filters.push({ leadVerification: { in: vals } });
  }
  if (q.dataCallingType) {
    const vals = splitCsv(q.dataCallingType);
    if (vals.length > 0) filters.push({ dataCallingType: { in: vals } });
  }
  if (q.dealType) {
    const vals = splitCsv(q.dealType);
    if (vals.length > 0) filters.push({ dealType: { in: vals } });
  }
  // Last, and the only clause that needs a query — skipped entirely when unused.
  const sessionYears = splitCsv(q.sessionYear);
  if (sessionYears.length > 0) filters.push(await sessionYearClause(db, sessionYears));

  return filters;
}

/**
 * Resolves the union of explicitly selected feedback option IDs and every
 * option belonging to the selected feedback categories, into the
 * `currentFeedbackOptionId` filter clause. Returns null when neither was
 * requested (i.e. no feedback-value/category filter should be applied).
 */
export async function buildFeedbackFilter(
  prisma: PrismaClient,
  feedbackOptionIds: string | undefined,
  feedbackCategoryIds: string | undefined,
): Promise<Record<string, unknown> | null> {
  const requestedOptionIds = splitCsv(feedbackOptionIds);
  const categoryIds = splitCsv(feedbackCategoryIds);
  if (requestedOptionIds.length === 0 && categoryIds.length === 0) return null;

  const optionIds = new Set(requestedOptionIds);
  if (categoryIds.length > 0) {
    const optionsInCategories = await prisma.feedbackOption.findMany({
      where: { categoryId: { in: categoryIds } },
      select: { id: true },
    });
    for (const o of optionsInCategories) optionIds.add(o.id);
  }
  // A filter was explicitly requested — even if it resolves to zero option
  // ids (e.g. an empty category), that must mean "match nothing", not
  // "no filter" (which would show/count all leads).
  return { currentFeedbackOptionId: { in: Array.from(optionIds) } };
}
