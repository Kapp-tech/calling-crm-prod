import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getRolePermissions } from '@/lib/permissions';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const permissions = await getRolePermissions(session.user.role);
    return NextResponse.json(permissions);
  } catch (error) {
    console.error('[users/me/permissions GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
