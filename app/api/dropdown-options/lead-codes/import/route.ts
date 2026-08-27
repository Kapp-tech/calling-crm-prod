import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { applyLeadCodeMapping } from '@/lib/lead-code';

/**
 * Bulk import of lead code → Data Calling Type.
 *
 * The file is parsed in the browser (Papa, same as the leads upload) and posted
 * as rows, so this endpoint only has to validate and store. Every row is
 * checked against the live Data Calling Type list — a value that is not one of
 * the active options is rejected with its row number rather than quietly
 * written, because a mapping pointing at a type that does not exist would put a
 * value on leads that no filter or upload would ever accept.
 */

/**
 * Deliberately permissive: rows are validated one at a time below so a single
 * bad line is reported and skipped rather than rejecting the whole file. A
 * schema that required every row to be valid meant one blank lead code threw
 * away an otherwise good upload of thousands.
 */
const bodySchema = z.object({
  rows: z.array(z.object({
    leadCode: z.string().max(200),
    dataCallingType: z.string().max(200),
  })).min(1).max(5000),
});

export interface ImportRowError {
  row: number;
  leadCode: string;
  reason: string;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Give at least one row of lead_code and data_calling_type (max 5000).' }, { status: 400 });
  }

  try {
    // Canonical spelling keyed by lower-case, so "l1" in a file is accepted and
    // stored as "L1" — the exact string the filters and the leads carry.
    const callingTypes = new Map(
      (await prisma.dropdownOption.findMany({
        where: { type: 'DATA_CALLING_TYPE', isActive: true },
        select: { value: true },
      })).map((o) => [o.value.trim().toLowerCase(), o.value.trim()]),
    );
    if (callingTypes.size === 0) {
      return NextResponse.json(
        { error: 'No active Data Calling Types exist yet — add them under Manage Dropdowns → Data Calling Type first.' },
        { status: 400 },
      );
    }

    // Existing codes, keyed case-insensitively. Matching on the lower-cased
    // value rather than upserting on the unique (type, value) index: that index
    // is case-sensitive, so "ckt200" in a file would have created a second row
    // beside an existing "CKT200" and the two would fight over the same leads.
    const existing = new Map(
      (await prisma.dropdownOption.findMany({
        where: { type: 'LEAD_CODE' },
        select: { id: true, value: true },
      })).map((o) => [o.value.trim().toLowerCase(), o.id]),
    );

    const errors: ImportRowError[] = [];
    /** Last row wins for a code repeated inside one file, and the file is told. */
    const wanted = new Map<string, { leadCode: string; callingType: string }>();
    let duplicatesInFile = 0;

    parsed.data.rows.forEach((raw, i) => {
      const row = i + 2; // +1 for zero-index, +1 for the header line
      const r = { leadCode: raw.leadCode.trim(), dataCallingType: raw.dataCallingType.trim() };
      if (!r.leadCode) {
        errors.push({ row, leadCode: '', reason: 'lead_code is blank' });
        return;
      }
      if (!r.dataCallingType) {
        errors.push({ row, leadCode: r.leadCode, reason: 'data_calling_type is blank' });
        return;
      }
      const canonical = callingTypes.get(r.dataCallingType.toLowerCase());
      if (!canonical) {
        errors.push({
          row, leadCode: r.leadCode,
          reason: `"${r.dataCallingType}" is not an active Data Calling Type (allowed: ${Array.from(callingTypes.values()).join(', ')})`,
        });
        return;
      }
      const key = r.leadCode.toLowerCase();
      if (wanted.has(key)) duplicatesInFile += 1;
      wanted.set(key, { leadCode: r.leadCode, callingType: canonical });
    });

    let created = 0;
    let updated = 0;
    let leadsUpdated = 0;

    for (const [key, { leadCode, callingType }] of Array.from(wanted.entries())) {
      const id = existing.get(key);
      if (id) {
        await prisma.dropdownOption.update({
          where: { id },
          // Reactivated on import: re-uploading a code an admin had switched off
          // is a clear instruction to use it again.
          data: { leadCodeCallingType: callingType, isActive: true },
        });
        updated += 1;
      } else {
        await prisma.dropdownOption.create({
          data: { type: 'LEAD_CODE', value: leadCode, leadCodeCallingType: callingType, createdBy: session.user.id },
        });
        created += 1;
      }
      leadsUpdated += await applyLeadCodeMapping(prisma, leadCode, callingType);
    }

    return NextResponse.json({
      created, updated, leadsUpdated, duplicatesInFile,
      rejected: errors.length,
      // Capped so one badly-formed file cannot return a megabyte of errors.
      errors: errors.slice(0, 100),
    });
  } catch (err) {
    console.error('[lead-codes import]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
