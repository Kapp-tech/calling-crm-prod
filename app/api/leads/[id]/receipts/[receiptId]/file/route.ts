import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { readReceiptFile } from '@/lib/receipt-storage';
import { canAccessLead } from '@/lib/lead-access';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; receiptId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const allowed = await canAccessLead(session.user, params.id);
    if (!allowed) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const receipt = await prisma.leadReceipt.findUnique({ where: { id: params.receiptId } });
    if (!receipt || receipt.leadId !== params.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const bytes = await readReceiptFile(receipt.filePath).catch(() => null);
    if (!bytes) return NextResponse.json({ error: 'File not found' }, { status: 404 });

    // Buffer is structurally a Uint8Array and is a valid Response body at
    // runtime; @types/node's ArrayBufferLike vs lib.dom's ArrayBuffer generic
    // mismatch is a type-checker-only artifact here.
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': receipt.fileMimeType,
        'Content-Disposition': `inline; filename="${encodeURIComponent(receipt.fileOriginalName)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[leads/[id]/receipts/[receiptId]/file GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
