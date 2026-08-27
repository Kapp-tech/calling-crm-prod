import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { callingTypeForIngest } from '@/lib/lead-code';
import { planPriorityAssignments } from '@/lib/priority-assignment';
import { hasPermission } from '@/lib/permissions';
import { buildDropdownValidationSets, isAllowedDropdownValue } from '@/lib/dropdown-validation';
import { Feature, DropdownType } from '@prisma/client';

const leadSchema = z.object({
  name:        z.string().min(1),
  email:       z.string().email(),
  phone:       z.string().min(1),
  college:     z.string().min(1),
  city:        z.string().optional().nullable(),
  state:       z.string().optional().nullable(),
  course:      z.string().optional().nullable(),
  campaign:    z.string().optional().nullable(),
  lead_type:   z.string().optional().nullable(),
  lead_origin: z.string().optional().nullable(),
  lead_zone:   z.string().optional().nullable(),
  lead_confirmation:           z.string().optional().nullable(),
  lead_stage:                  z.string().optional().nullable(),
  lead_verification:           z.string().optional().nullable(),
  data_calling_type:           z.string().optional().nullable(),
  deal_type:                   z.string().optional().nullable(),
  created_at:                  z.string().optional().nullable(),
});

const uploadSchema = z.object({
  fileName:     z.string().min(1),
  leads:        z.array(leadSchema).min(1).max(5000),
  errorRecords: z.number().int().min(0).default(0),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const canUpload = await hasPermission(session.user.role, Feature.UPLOAD_LEADS);
    if (!canUpload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Check per-upload batch size limit
    const limitSetting = await prisma.setting.findUnique({ where: { key: 'upload_limit_per_batch' } });
    const batchLimit = limitSetting ? parseInt(limitSetting.value, 10) : null;

    const body = await req.json();
    const parsed = uploadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const parseDate = (s: string | null | undefined): Date | null => {
      if (!s?.trim()) return null;
      const d = new Date(s.trim());
      return isNaN(d.getTime()) ? null : d;
    };

    const { fileName, leads, errorRecords: clientErrorCount } = parsed.data;

    // Reject if batch exceeds the configured per-upload limit
    if (batchLimit && !isNaN(batchLimit) && leads.length > batchLimit) {
      return NextResponse.json(
        { error: `This CSV has ${leads.length.toLocaleString()} rows which exceeds the allowed limit of ${batchLimit.toLocaleString()} rows per upload. Please split your file and try again.` },
        { status: 422 }
      );
    }

    const incomingEmails = leads.map((l) => l.email.trim().toLowerCase());

    // ── Fetch all active dropdown options for validation ─────────────────────
    // leadCodeCallingTypeMap: lead code → Data Calling Type. A mapped code wins
    // over whatever the CSV carried, exactly as it does when the mapping is
    // saved. It comes off the same prebuilt object as the college attributes,
    // so there is one loader rather than two that could drift.
    const { sets: dropdownSets, collegeIdMap, collegeAttributeMap, leadCodeCallingTypeMap } =
      await buildDropdownValidationSets();
    const allowed = (t: DropdownType, v: string | null | undefined) =>
      isAllowedDropdownValue({ sets: dropdownSets, collegeIdMap, collegeAttributeMap, leadCodeCallingTypeMap }, t, v);

    // ── Validate each lead against dropdown options ───────────────────────────
    type LeadInput = typeof leads[number];
    type ResolvedLead = LeadInput & { _resolvedCollege?: string; _kappCollegeId?: string };
    const validLeads:   ResolvedLead[] = [];
    const invalidLeads: { row: number; email: string; errors: string[] }[] = [];

    leads.forEach((lead, i) => {
      const errs: string[] = [];

      // College: CSV value is a KAPP College ID — look up the college name
      let resolvedCollege: string | undefined;
      let kappCollegeId:   string | undefined;
      const rawCollegeId = lead.college?.trim() ?? '';

      if (collegeIdMap.size > 0) {
        if (rawCollegeId) {
          resolvedCollege = collegeIdMap.get(rawCollegeId.toLowerCase());
          if (!resolvedCollege) {
            errs.push(`college "${rawCollegeId}" is not a valid KAPP College ID`);
          } else {
            kappCollegeId = rawCollegeId; // preserve original ID from CSV
          }
        }
      } else if (rawCollegeId) {
        // No college map configured — store raw value as-is
        resolvedCollege = rawCollegeId;
      }

      if (!allowed(DropdownType.LEAD_TYPE,          lead.lead_type))         errs.push(`lead_type "${lead.lead_type}" is not in the allowed list`);
      if (!allowed(DropdownType.LEAD_ORIGIN,        lead.lead_origin))       errs.push(`lead_origin "${lead.lead_origin}" is not in the allowed list`);
      // lead_zone and deal_type are no longer taken from the CSV — they come
      // from the college's own configuration (see the lead build below), so
      // there is nothing to validate here.
      if (!allowed(DropdownType.LEAD_CONFIRMATION,  lead.lead_confirmation)) errs.push(`lead_confirmation "${lead.lead_confirmation}" is not in the allowed list`);
      if (!allowed(DropdownType.LEAD_STAGE,         lead.lead_stage))        errs.push(`lead_stage "${lead.lead_stage}" is not in the allowed list`);
      if (!allowed(DropdownType.LEAD_VERIFICATION,  lead.lead_verification)) errs.push(`lead_verification "${lead.lead_verification}" is not in the allowed list`);
      // data_calling_type is still accepted in the file but no longer checked or
      // used: the lead code decides it. Rejecting a row over a column that has
      // no effect would fail uploads for nothing.


      if (errs.length > 0) {
        invalidLeads.push({ row: i + 2, email: lead.email, errors: errs }); // row +2: header=1, 0-indexed
      } else {
        validLeads.push({ ...lead, _resolvedCollege: resolvedCollege, _kappCollegeId: kappCollegeId });
      }
    });

    const totalErrorRecords = clientErrorCount + invalidLeads.length;

    const result = await prisma.$transaction(async (tx) => {
      // Fetch existing leads that share any of the incoming emails (email + college for duplicate key)
      const existing = await tx.lead.findMany({
        where: { email: { in: validLeads.map((l) => l.email.trim().toLowerCase()) } },
        select: { email: true, college: true },
      });

      // Duplicate key = email + college (both lowercased; null treated as empty string)
      const existingKeys = new Set(
        existing.map((l) => `${l.email.toLowerCase()}|${(l.college ?? '').trim().toLowerCase()}`)
      );

      const dupKey = (l: { email: string; college?: string | null }) =>
        `${l.email.trim().toLowerCase()}|${(l.college ?? '').trim().toLowerCase()}`;

      // Resolve college names before dedup (use resolved name for dedup key too)
      const resolvedValid = validLeads.map((l) => ({
        ...l,
        college: l._resolvedCollege ?? l.college,
      }));

      const alreadyInDb = resolvedValid.filter((l) => existingKeys.has(dupKey(l)));

      // De-duplicate the file against itself as well as against the database.
      //
      // Checking only the database was the whole bug: every copy of a row inside
      // one file is genuinely absent from the Lead table at the moment of the
      // check, so all of them passed and createMany inserted the lot. A single
      // upload on 22 Aug 2026 put 370 rows in for 88 real people — 282 surplus —
      // and because leads are round-robin assigned, five different agents ended
      // up separately phoning the same person.
      //
      // Same key as the database check (email + college), so a row is treated
      // identically whether its twin is in the file or already stored. The first
      // occurrence wins, which keeps the result predictable: it is the row the
      // person who built the file would expect to survive.
      const seenInFile = new Set<string>();
      const toInsert: typeof resolvedValid = [];
      const repeatedInFile: typeof resolvedValid = [];
      for (const lead of resolvedValid) {
        const key = dupKey(lead);
        if (existingKeys.has(key)) continue;      // counted in alreadyInDb
        if (seenInFile.has(key)) {
          repeatedInFile.push(lead);
          continue;
        }
        seenInFile.add(key);
        toInsert.push(lead);
      }

      const duplicateList = [...alreadyInDb, ...repeatedInFile];
      const duplicateEmails = duplicateList.map((l) => l.email.trim().toLowerCase());

      const batch = await tx.uploadBatch.create({
        data: {
          fileName,
          uploadedById:     session.user.id,
          totalRecords:     leads.length + clientErrorCount,
          insertedRecords:  toInsert.length,
          duplicateRecords: duplicateList.length,
          errorRecords:     totalErrorRecords,
          status: 'COMPLETED',
        },
      });

      if (toInsert.length > 0) {
        /**
         * Priority auto-assignment.
         *
         * Planned for the whole file in one go — one cursor write instead of
         * one per lead — and worked out from the calling type the lead will
         * actually be stored with, which for a mapped lead code is the mapping's
         * value rather than anything the CSV said.
         *
         * These rows are created PENDING, so an auto-assigned lead is not
         * visible to its agent until it is approved. That is deliberate: the
         * assignment is decided now and simply waits, rather than putting
         * unapproved leads in somebody's queue.
         */
        const callingTypes = toInsert.map((lead) =>
          callingTypeForIngest(leadCodeCallingTypeMap, lead.campaign));
        const priorityAgents = await planPriorityAssignments(tx, callingTypes);
        const assignedAt = new Date();

        await tx.lead.createMany({
          data: toInsert.map((lead, i) => ({
            // Not @updatedAt any more (see schema.prisma) — a new lead reads as
            // its creation time until the first feedback advances it.
            updatedAt:  new Date(),
            name:       lead.name.trim(),
            email:      lead.email.trim().toLowerCase(),
            phone:      lead.phone.trim(),
            city:       lead.city?.trim()       || null,
            state:      lead.state?.trim()      || null,
            course:     lead.course?.trim()     || null,
            college:       lead.college?.trim()    || null,
            kappCollegeId: lead._kappCollegeId   || null,
            campaign:      lead.campaign?.trim()  || null,
            leadType:   lead.lead_type?.trim()  || null,
            leadOrigin: lead.lead_origin?.trim()|| null,
            // Zone and Deal Type are properties of the college, configured in
            // Manage Colleges, so they are copied from there rather than read
            // from the CSV. A college with neither configured leaves them null.
            leadZone:   collegeAttributeMap.get((lead._kappCollegeId ?? '').toLowerCase())?.zone     ?? null,
            primaryApplicationConfirm: 'No',
            primaryAdmissionConfirm:   'No',
            leadConfirmation:          lead.lead_confirmation?.trim()           || null,
            leadStage:                 lead.lead_stage?.trim()                  || null,
            leadVerification:          lead.lead_verification?.trim()           || null,
            // Lead code decides this, not the CSV column: an unmapped code
            // lands as "NA" so it is visibly waiting to be mapped.
            dataCallingType: callingTypes[i],
            ...(priorityAgents[i] ? { assignedToId: priorityAgents[i]!, assignedAt } : {}),
            dealType:   collegeAttributeMap.get((lead._kappCollegeId ?? '').toLowerCase())?.dealType ?? null,
            uploadedAt:                parseDate(lead.created_at),
            status:      'PENDING',
            uploadedById: session.user.id,
            batchId:      batch.id,
          })),
        });
      }

      return {
        batchId:        batch.id,
        fileName:       batch.fileName,
        inserted:       toInsert.length,
        duplicates:     duplicateEmails,
        // Split out so the person uploading can tell "this lead is already in
        // the CRM" from "your file lists this lead more than once" — two
        // different problems with two different fixes.
        alreadyInCrm:   alreadyInDb.length,
        repeatedInFile: repeatedInFile.length,
        total:          leads.length + clientErrorCount,
        invalidLeads,
      };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('[upload POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const canUpload = await hasPermission(session.user.role, Feature.UPLOAD_LEADS);
    if (!canUpload && session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const where =
      session.user.role === 'SUPER_ADMIN' ? {} : { uploadedById: session.user.id };

    const batches = await prisma.uploadBatch.findMany({
      where,
      include: {
        uploadedBy: { select: { id: true, name: true } },
        _count: { select: { leads: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(batches);
  } catch (error) {
    console.error('[upload GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
