import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessLead } from '@/lib/lead-access';
import {
  MAX_RECEIPT_FILE_SIZE,
  isAllowedReceiptFile,
  saveReceiptFile,
  buildReceiptDisplayFileName,
} from '@/lib/receipt-storage';

// Magic-byte signatures for the three accepted formats — checked in addition
// to the browser-reported MIME type, since that header is fully client
// controlled and trivially spoofable.
const MAGIC_BYTES: Record<string, number[]> = {
  'image/png':  [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'application/pdf': [0x25, 0x50, 0x44, 0x46], // %PDF
};

function matchesMagicBytes(mimeType: string, bytes: Buffer): boolean {
  const sig = MAGIC_BYTES[mimeType];
  if (!sig) return false;
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

const optionalString = z.string().trim().max(200).optional().or(z.literal(''));

const receiptSchema = z.object({
  type: z.enum(['APPLICATION', 'ADMISSION']),
  campusName: z.string().trim().min(1).max(300),
  couponCodeApplied: z.enum(['Yes', 'No']),
  referralCode: optionalString,
  paidDate: z.string().trim().min(1).pipe(z.coerce.date()),
  receiptNumber: z.string().trim().min(1).max(100),
  actualAmount: optionalString,
  amountPaid: z.string().trim().min(1).max(50),
  courseId: z.string().trim().min(1).max(100),
  courseName: z.string().trim().min(1).max(300),
  studentName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  altEmail: z.union([z.string().trim().email().max(200), z.literal('')]).optional(),
  mobile: z.string().trim().min(1).max(30),
  altMobile: z.string().trim().max(30).optional().or(z.literal('')),
  city: optionalString,
  state: z.string().trim().min(1).max(200),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const allowed = await canAccessLead(session.user, params.id);
    if (!allowed) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
    }

    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: 'A receipt file is required' }, { status: 400 });
    }
    if (file.size > MAX_RECEIPT_FILE_SIZE) {
      return NextResponse.json({ error: 'File exceeds the 10 MB size limit' }, { status: 400 });
    }
    if (!isAllowedReceiptFile(file.type)) {
      return NextResponse.json(
        { error: 'Unsupported file type — only PNG, JPG, and PDF are allowed' },
        { status: 400 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (!matchesMagicBytes(file.type, bytes)) {
      return NextResponse.json({ error: 'File contents do not match its declared type' }, { status: 400 });
    }

    const rawFields: Record<string, string> = {};
    for (const key of [
      'type', 'campusName', 'couponCodeApplied', 'referralCode', 'paidDate',
      'receiptNumber', 'actualAmount', 'amountPaid', 'courseId', 'courseName',
      'studentName', 'email', 'altEmail', 'mobile', 'altMobile', 'city', 'state',
    ]) {
      const v = formData.get(key);
      if (typeof v === 'string') rawFields[key] = v;
    }

    const parsed = receiptSchema.safeParse(rawFields);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const d = parsed.data;

    const filePath = await saveReceiptFile(params.id, file.type, bytes);

    const receipt = await prisma.leadReceipt.create({
      data: {
        type: d.type,
        leadId: params.id,
        campusName: d.campusName,
        couponCodeApplied: d.couponCodeApplied === 'Yes',
        referralCode: d.couponCodeApplied === 'Yes' && d.referralCode ? d.referralCode : null,
        paidDate: d.paidDate,
        receiptNumber: d.receiptNumber,
        actualAmount: d.actualAmount || null,
        amountPaid: d.amountPaid,
        courseId: d.courseId,
        courseName: d.courseName,
        studentName: d.studentName,
        email: d.email,
        altEmail: d.altEmail || null,
        mobile: d.mobile,
        altMobile: d.altMobile || null,
        city: d.city || null,
        state: d.state,
        fileOriginalName: buildReceiptDisplayFileName(d.receiptNumber, d.campusName, rawFields.paidDate, file.type),
        filePath,
        fileMimeType: file.type,
        fileSize: file.size,
        uploadedById: session.user.id,
      },
      include: { uploadedBy: { select: { name: true } } },
    });

    return NextResponse.json(receipt, { status: 201 });
  } catch (error) {
    console.error('[leads/[id]/receipts POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const allowed = await canAccessLead(session.user, params.id);
    if (!allowed) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const receipts = await prisma.leadReceipt.findMany({
      where: { leadId: params.id },
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { name: true } } },
    });

    // Never expose the on-disk file path to the client — files are served
    // only via the authenticated /file route, keyed by receipt id.
    const sanitized = receipts.map(({ filePath: _filePath, ...rest }) => rest);
    return NextResponse.json(sanitized);
  } catch (error) {
    console.error('[leads/[id]/receipts GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
