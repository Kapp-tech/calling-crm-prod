import { z } from 'zod';
import type { PrismaClient, Role } from '@prisma/client';
import { LeadStatus } from '@prisma/client';

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
  assignmentStatus: z.enum(['all', 'unassigned', 'assigned']).optional(),
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
});

export type NonFeedbackQuery = z.infer<typeof nonFeedbackQuerySchema>;

export function splitCsv(v: string | undefined): string[] {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

export function buildNonFeedbackFilters(
  q: NonFeedbackQuery,
  sessionUser: { id: string; role: Role },
): Record<string, unknown>[] {
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
  if (q.dateFrom) filters.push({ createdAt: { gte: new Date(q.dateFrom) } });
  if (q.dateTo) {
    const end = new Date(q.dateTo);
    end.setHours(23, 59, 59, 999);
    filters.push({ createdAt: { lte: end } });
  }
  if (q.updatedFrom) filters.push({ updatedAt: { gte: new Date(q.updatedFrom) } });
  if (q.updatedTo) {
    const end = new Date(q.updatedTo);
    end.setHours(23, 59, 59, 999);
    filters.push({ updatedAt: { lte: end } });
  }
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
